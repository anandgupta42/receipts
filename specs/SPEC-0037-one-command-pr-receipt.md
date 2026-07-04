---
id: SPEC-0037
title: "One-command PR receipt finalizer"
status: building
milestone: M4
depends: [SPEC-0019, SPEC-0036]
---

# SPEC-0037 · One-command PR receipt finalizer

Invariants: I1 (deterministic local selection/rendering; zero model calls), I2 (no
fabricated dollars), I3 (receipt numbers and attribution remain traceable), I4 (local
transcripts stay local; only explicit GitHub posting uses the network), I5 (comment body
stays byte-stable), I6 (reports facts, never assistant/model rankings).

## Purpose

Make PR receipt adoption clear enough that any human or coding assistant can run one
same command from any repo checkout:

```sh
npx aireceipts pr --post
```

No hook install, no repo-local alias, no assistant-specific wrapper, no CI transcript
upload. The command owns discovery, attribution, rendering, and posting; CI only reminds
or optionally enforces presence.

## Requirements

- **R1 - One blessed command.** `npx aireceipts pr --post` is the documented final step
  for every assistant and every repo. Existing dry-run behavior stays available through
  `npx aireceipts pr`, but docs, PR template copy, and assistant instructions must name
  the posting command as the primary path.
- **R2 - Works without setup.** A contributor must not need to install a hook, create a
  git alias, copy a repo helper script, or configure their assistant before the command
  can generate a receipt. The command runs from the current checkout/worktree and uses
  the existing CLI dispatch (`src/cli/commands/pr.ts:7-14`,
  `src/cli/registry.ts:68-76`) and option parser (`src/cli/options.ts:54-169`).
- **R3 - Cross-assistant by adapter registry.** The command must discover sessions
  through the registered adapters, not through assistant-specific command names. New
  adapters participate by joining the registry (`src/parse/registry.ts:11-29`) and the
  PR path must keep using the shared session-discovery dependency
  (`src/pr/index.ts:84-137`). Claude Code, Codex, and OpenCode coverage are acceptance
  fixtures; unsupported assistants produce a clear "no supported sessions found" message
  with the searched adapter names.
- **R4 - Cross-repo and worktree aware.** The command resolves the current git worktree,
  branch SHAs, and commit window itself (`src/pr/git.ts:63-69`,
  `src/pr/git.ts:90-118`). It must work from repo root, subdirectories, and sibling
  worktrees. It must not require aireceipts-specific files in the target repo.
- **R5 - Render-first reliability.** The receipt body always prints before any GitHub
  write (`src/pr/index.ts:216-292`). If `gh` is missing, unauthenticated, or no PR exists,
  the user still gets the exact copyable body plus one actionable diagnostic from the
  existing PR resolver/upsert path (`src/pr/comment.ts:23-45`,
  `src/pr/comment.ts:77-119`).
- **R6 - Idempotent GitHub posting.** When `gh` is available and the branch has a PR,
  the command updates one marked comment rather than appending new comments
  (`src/pr/comment.ts:77-119`). Re-running after more commits is the normal workflow.
- **R7 - Clear failure modes.** Zero matches, multiple plausible matches, unsupported
  assistants, no git repo, missing `gh`, missing PR, and permission failures must each
  produce a short message that tells the user the next command or action. The command may
  exit non-zero for unresolved attribution or failed posting, but it must never hide the
  rendered body once it has enough data to render.
- **R8 - CI remains a detector, not a generator.** SPEC-0036 remains the repo-wide
  safety net: pull-request checks can notice a missing marked comment and optionally
  enforce same-repo presence, but CI never generates receipts because transcripts live on
  the author machine.
- **R9 - Optional helpers are secondary.** Git aliases, local hooks, and assistant
  project instructions may improve convenience, but none may be required for the core
  workflow. The Claude-specific hook installer (`src/hook/install.ts:55-95`) must stay
  documented as optional convenience, not as the universal PR-receipt path.
- **R10 - One assistant instruction snippet.** The docs must include a single copyable
  instruction suitable for Codex, Claude Code, OpenCode, Cursor, or any other assistant:
  "Before you finish a PR-producing task, run `npx aireceipts pr --post` from the repo
  worktree and include any failure message in the handoff." No assistant-specific
  variants unless an adapter has a real limitation.

## Scenarios

- **Given** a Claude Code, Codex, or OpenCode session that built the current branch,
  **when** an assistant runs `npx aireceipts pr --post`, **then** a receipt prints and one
  PR comment is created or updated.
- **Given** the same command is run from a nested package directory, **when** the repo has
  a PR, **then** the worktree root and branch commits resolve without extra flags.
- **Given** `gh` is missing, **when** the command can render a receipt, **then** the exact
  body prints before the "copy into your PR" diagnostic.
- **Given** more than one plausible session matches, **when** the command runs, **then**
  all plausible sessions contribute as a union with one receipt total (SPEC-0023 R1 semantics); `--session <id>` narrows explicitly when wanted.
- **Given** an unsupported assistant with no adapter, **when** the command runs, **then**
  it says no supported sessions were found and lists the supported adapters, rather than
  implying the PR does not need a receipt.
- **Given** a repo has the SPEC-0036 workflow but no receipt comment, **when** the PR is
  opened through GitHub UI, API, `gh`, or an assistant, **then** CI emits an advisory
  notice by default and points back to `npx aireceipts pr --post`.

## Non-goals

- **Default hook installation.** Hooks are per machine and often per tool. They cannot
  cover PRs opened from another checkout, GitHub UI/API, or a different assistant.
- **A repo-local wrapper as the primary UX.** It helps one repo after setup; it does not
  satisfy "every machine and every repo."
- **CI receipt generation or transcript upload.** That violates the local-first product
  boundary and would make PR adoption depend on sensitive local data leaving the machine.
- **Default failing PR checks.** SPEC-0036's default remains notice-only. Maintainers may
  opt into same-repo enforcement, but contributors should not get surprise red checks.
- **Non-GitHub posting.** The finalizer may render in any git repo, but comment posting
  remains GitHub/`gh`-based until a future forge spec exists.
- **Claiming universal adapter support.** The command is universal; adapter coverage is
  explicit. A new assistant is supported after its adapter lands in the registry and
  passes the same finalizer fixtures.

## Design

The current `pr` command is already the right spine. `src/cli/commands/pr.ts:7-14`
passes parsed flags into `runPr`, and `runPr` resolves branch data, contributor
selection, render, and optional posting in one path (`src/pr/index.ts:216-292`). This
spec does not introduce a separate hook-first or bot-first flow; it makes that path the
only blessed user story.

The command is portable because discovery is adapter-driven. `src/parse/registry.ts:11-29`
exposes registered adapters and detection; `resolveContributors` calls the shared session
listing dependency, filters by worktree/branch windows, and falls back to explicit
`--session` only when ambiguity requires it (`src/pr/index.ts:84-137`). OpenCode is not a
special command: its adapter must feed the same session summaries and loaded sessions as
Claude Code and Codex.

The user-facing refinement is clarity, not more automation. Docs and templates should
stop presenting aliases as the preferred route. The canonical block becomes:

```sh
npx aireceipts pr --post
```

The command may still recommend `--session <id>` when auto-attribution is ambiguous.
That is the only acceptable second command because guessing would violate I3.

Posting stays explicit because it is a network write. The `--post` flag is visible in the
one command, while render-first ordering keeps failed posting recoverable
(`src/pr/index.ts:216-292`). `upsertPrComment` keeps one marked comment current through
`gh api` create-or-patch (`src/pr/comment.ts:77-119`), preserving SPEC-0019's marker
contract and SPEC-0036's presence check.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 blessed command | docs/PR template/assistant guidance | all name `npx aireceipts pr --post` as the primary path |
| R2 no setup files | target repo lacks aireceipts config/alias/hook | command still renders from local transcripts |
| R3 Claude finalizer | fixture Claude session + mocked PR | `npx aireceipts pr --post` renders and upserts one comment |
| R3 Codex finalizer | fixture Codex session + mocked PR | same command renders and upserts one comment |
| R3 OpenCode finalizer | fixture OpenCode session + mocked PR | same command renders and upserts one comment |
| R4 nested cwd | command run below repo root | current worktree and branch commits resolve |
| R4 sibling worktree | session cwd under sibling worktree | eligible per existing worktree rules |
| R5 missing `gh` | `gh` runner missing | body prints, diagnostic says to copy into PR, exit 1 |
| R5 no PR | `gh pr view` fails | body prints, diagnostic names missing PR, exit 1 |
| R6 existing comment | marked comment exists | PATCH by id, no duplicate comment |
| R7 no sessions | no supported transcripts | clear supported-adapters diagnostic, no post attempt |
| R7 ambiguous sessions | two plausible sessions | candidate ids + `--session <id>`, no post |
| R7 unsupported assistant | transcripts from unregistered assistant only | unsupported/no-supported-sessions message names adapter boundary |
| R8 workflow notice | missing receipt in SPEC-0036 workflow | notice points to `npx aireceipts pr --post`, exit 0 by default |
| R9 optional hook docs | hook installer docs | labeled optional convenience only |
| R10 assistant snippet | one documented assistant instruction | same snippet applies to Claude Code, Codex, OpenCode, Cursor, and generic assistants |

## Success criteria

- [x] `docs/pr-receipts.md` has a "one command" contributor path that starts with
      `npx aireceipts pr --post` and demotes aliases/hooks to optional convenience.
- [x] The PR template Evidence block asks for the receipt generated by that exact
      command.
- [x] A single assistant-instruction snippet is documented for all coding assistants.
- [ ] E2E coverage proves the same command path for Claude Code, Codex, and OpenCode
      fixtures.
- [ ] Failure-mode tests cover missing `gh`, no PR, no sessions, ambiguous sessions, and
      unsupported assistant transcripts.
- [x] SPEC-0036 workflow/docs still say CI checks presence only and is notice-only by
      default.
- [ ] Acceptance testing performed live with the blessed command itself
      (`npx aireceipts pr --post`, or its source-checkout equivalent with `--post`)
      — the recorded run used `node dist/cli.js pr --session …` without posting;
      box re-opened by independent review (S2 finding 2).
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, and `node scripts/hygiene.mjs` all pass unmasked.

## Open questions

- **Should `--post` stay visible in the blessed command?** Proposed default: yes. It is
  still one command, and the explicit flag makes the GitHub network write obvious.
- **Should there be a shorter alias command later, such as `aireceipts done`?** Proposed
  default: no for this spec. It would fragment docs before the existing `pr` command is
  proven clear enough.
- **Should optional hooks run the finalizer automatically?** Proposed default: no. Hooks
  can print a reminder, but auto-posting from a hook risks surprising network writes.

## Validation

**2026-07-04 · S1 (self):** This draft converts the maintainer's UX requirement into a
single portable command surface while preserving SPEC-0019/SPEC-0036's trust boundary:
local generation, explicit posting, CI presence detection only, and no default blocking.

**2026-07-04 · S2 (maintainer review): APPROVED.** Maintainer approved the spec
in-session ("approved . make sure to update the docs"). Implementation scope for this
PR is the docs/process surface: make `npx aireceipts pr --post` the primary documented
path, keep hooks/aliases optional, and preserve existing render-first command behavior.

**2026-07-04 · S3 (docs/process implementation): PASS.** `docs/pr-receipts.md` now
starts contributor guidance with exactly `npx aireceipts pr --post`, adds the
assistant-agnostic instruction snippet, and demotes git aliases and Claude hooks to
optional convenience. `.github/pull_request_template.md`, `.claude/skills/build-spec`,
and README now name the same one-command PR finalizer. Live acceptance:
`node dist/cli.js pr --session rollout-2026-07-03T15-45-24-019f2a28-7ef1-7093-81f8-c35053291712`
printed a marked `<!-- aireceipts-dogfood -->` PR body and exited 0. Gates passed
unmasked: `npx tsc --noEmit` 0, `npx eslint . --max-warnings 0` 0, `npx vitest run`
998 tests passed, goldens byte-identical, determinism 10/10 byte-identical,
`spec-lint` 34 specs OK, hygiene OK.

**2026-07-04 · record corrected (lead session):** the entry above labeled
"S2 (maintainer review)" is a **button-1 approval**, not an S2 — S2 is the
independent adversarial critic, which had not run. It has now.

**2026-07-04 · S2 (Codex, read-only, full capture): REWORK → applied on this
branch.** 6 findings:
1. HIGH — the blessed command is not honest until npm publish (README/install
   docs say source-first) — **accepted**: pre-release note added beside the
   one-command block in docs/pr-receipts.md; deleted by the release flow with
   the README caveat.
2. HIGH — live-acceptance box was checked on a `node dist/cli.js pr --session`
   run that neither used the blessed command nor posted — **accepted**: box
   re-opened with the reason inline.
3. MEDIUM — ambiguous-session contract ("refuse and print candidates")
   contradicts shipped SPEC-0023 R1 union semantics — **accepted**: the
   union IS the designed behavior; requirement reworded to match, refusal
   language removed.
4. MEDIUM — "unsupported assistant" diagnostics promised beyond the real
   seam (adapter failures collapse to empty lists in src/parse/load.ts:21) —
   **accepted**: diagnostic scoped to what runPr can truthfully say; richer
   diagnostics moved to the unbuilt-slice requirements where the seam work
   belongs.
5. MEDIUM — fork/external-repo posting unpinned (upsert wrote through
   git-context placeholders) — **accepted as already fixed elsewhere**: PR
   #87's S6 patch makes upsertPrComment address the resolved base repo
   explicitly; this spec's unbuilt e2e slice gains a fork-PR row.
6. MEDIUM — the wiring test pins prose ordering, not the operational story —
   **accepted as scoped**: that is exactly what a docs-slice test can pin;
   the operational assertions live in the unbuilt e2e slice's rows.
