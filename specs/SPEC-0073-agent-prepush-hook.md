---
id: SPEC-0073
title: "Agent auto-attach — a hook pre-push subcommand + zero-install adopter kit"
status: shipped
milestone: M5
depends: [SPEC-0064, SPEC-0065]
---

# SPEC-0073: Agent auto-attach — `hook pre-push` subcommand + zero-install adopter kit

## Purpose

Receipts only reach a PR when a branch carries a `refs/aireceipts/<slug>` ref (SPEC-0065/0066)
and CI posts it (SPEC-0064 `pr-check`). Today aireceipts produces that ref only via the
committed `.githooks/pre-push` (this repo's own contributors, `npm run setup:hooks`) or a
manual `npx aireceipts-cli pr --store ref --push-ref`. An **adopter** repo therefore gets
*nothing* automatically — the org dogfood rollout added the CI post side to 19 repos and
observed **zero receipts**, because no ref is ever produced.

At initial shipment, the internal sibling made it automatic with **one committed file**: a Claude Code
`.claude/settings.json` `PreToolUse: Bash` hook that runs its `hook pre-push` subcommand, so
when the coding agent runs `git push` the receipt ref is written and pushed with **no extra
step**. This spec brings the same to aireceipts: **R1** a `hook pre-push` subcommand that reads
the agent hook payload and attaches the ref only on a real branch push, never blocking; **R2**
an adopter kit that commits an agent hook alongside the `pr-check` workflow. Codex added
stable project hooks after this spec shipped; the maintenance update now includes the same
producer as `.codex/hooks.json` without changing the producer or ref format.

Boundary unchanged: generation is local (I1/I4); the hook only writes+pushes a deterministic
ref (SPEC-0065). It **never blocks the push from succeeding** and never fabricates a receipt
(I2); the delay it adds is **bounded** by the hook timeout, not zero (see R2).

## Requirements

- **R1 — `aireceipts hook pre-push` (hidden) reads a PreToolUse payload and attaches on branch
  push only, using the tokenized command parser (no substring matching).** *(Amended 2026-07-13,
  #241.)* It reads a JSON object
  on stdin (the Claude Code hook payload: `{ tool_name, tool_input: { command } }`, and the
  equivalent Codex shape where present). It acts **only** when `tool_name` is a shell tool
  (`Bash`) **and** `tool_input.command`, parsed with the repo's existing tokenized git-command
  parser (`src/pr/gitWrite.ts` — the same one that already rejects quoted/echoed/heredoc
  `git push` and handles `git -C <dir>` / env-prefix forms; extend it, don't substring-match),
  is a `git push` to **`origin`** (the only remote `--push-ref` targets) of the **current
  branch** (a bare `git push`, `git push origin`, `git push origin <branch>`, or an explicit
  `HEAD:refs/heads/<branch>` refspec). It must **NOT** act on: non-`git` commands; `git`
  non-`push` verbs; `git push --delete`/`--tags`-only/`--prune`-only/`--dry-run`; a push whose
  only refspec is `refs/aireceipts/*` (recursion guard); a push to a non-`origin` remote; a
  **repo-retargeting push** (`git -C <dir> push`, `--git-dir`/`--work-tree`/`--namespace`/
  `--exec-path`) whose target repo/worktree differs from the hook's cwd — the attach only runs
  against the hook's cwd, so attaching would write the ref to the wrong repo; or any push
  invocation the parser cannot unambiguously resolve to the above (heredocs and aliases remain
  **no action**, under-attach). The parser tokenizes the whole shell command, strips shell
  redirections from each invocation before push classification, and acts exactly once when **at
  least one** invocation is an attachable branch push — including in `&&`/`;`/pipe chains — as
  long as **no** `cd`, `pushd`, or `popd` invocation appears anywhere in the command. A cwd change
  before or after the push is conservatively refused because invocation ordering across shell
  operators cannot safely retarget the attach, which must run against the hook's cwd. When it
  acts, it runs the existing
  `pr --store ref --push-ref` path (SPEC-0065) — which writes the deterministic ref and pushes it
  to `origin`. A spurious attach is harmless by construction (the ref is deterministic and the
  session is real — it only writes a correct ref slightly early), but ambiguity still resolves to
  no-action to honor I2 and avoid needless network writes.
- **R2 — never blocks the push; bounded, best-effort delay; zero stdout; always exit 0.** The
  subcommand returns exit 0 on **every** path (success, no-match, missing session, no `git`, ref
  write/push failure, malformed/empty stdin, any thrown error — all swallowed) and writes
  **nothing to stdout** (a PreToolUse hook's stdout can carry a permission-decision JSON; the
  reused `runPrDetailed` is invoked with **no-op `out`/`err` writers** so its rendered body and
  status lines never reach the hook's stdout/stderr). It emits **no** decision object. Because
  the supported agent hosts run a `PreToolUse` command hook before the matched push, the hook
  does add latency: this is **bounded** by the per-hook `timeout`
  (R3) and the attach is best-effort within it — a slow/failed ref push is abandoned at timeout
  and the developer's push proceeds regardless. The invariant is "the push always succeeds and is
  never gated on the receipt," **not** "zero added latency." (A background/async variant was
  rejected: it would let the ref race the branch push so the first CI run could miss it.)
- **R3 — per-event `.claude/settings.json` helpers + a distinct PreToolUse entry.** The current
  settings helpers (`src/hook/settings.ts`) are hardcoded to `hooks.SessionEnd`; R3 generalizes
  them to operate **per event** (add/detect/remove keyed on `(event, command)`), preserving
  unrelated keys, existing SessionEnd entries, and any pre-existing PreToolUse entries. The kit
  adds a `PreToolUse` entry with `matcher: "Bash"` running `npx -y aireceipts-cli@<pin> hook
  pre-push` with a per-hook `timeout` (bounds R2's delay). The pre-push timeout is **larger than
  the SessionEnd `--mini` hook's** (60s vs 10s): its first invocation on a cold npm cache must
  download the package (incl. the `@resvg/resvg-js` native dep) before it can write the ref, and
  10s can expire mid-download — silently missing the first push's receipt. 60s is still bounded
  (the push is never gated on the receipt). It is **separate** from the SessionEnd
  `--mini` entry (SPEC-0006) — both coexist; installing/removing one never touches the other.
  Idempotent: re-adding is a no-op; `(PreToolUse, command)` is the identity key.
- **R4 — the workflow + agent-producer adopter kit.** `docs/adopt/` documents
  `.github/workflows/aireceipts.yml` (the `pr-check` post side, SPEC-0064) plus the producer
  hook for each agent in use: `.claude/settings.json` for Claude Code and
  `.codex/hooks.json` for Codex. The kit states plainly that the workflow alone is a no-op
  until a hook (or a manual `pr --store ref --push-ref`) produces a ref. `aireceipts
  integrations` surfaces the same recipe.
- **R5 — collision safety with a sibling ref producer (RESOLVED).** aireceipts writes and reads
  only its own `refs/aireceipts/*` namespace (SPEC-0065 R1), so it never touches a sibling tool's
  `refs/receipts/*` refs and the two coexist without fighting over a ref. This closed a real
  field collision: while both tools shared `refs/receipts/*`, an org repo running an in-toto
  attestation producer left every `refs/receipts/<slug>` occupied by a foreign payload, so
  `pr-check` fetched it, failed its `schemaVersion` check, and silently posted nothing (fails
  safe — rejects, no fabrication — but also never posts an aireceipts receipt). The dedicated
  namespace removes the hazard; the kit's docs now state that coexistence is safe.
- **R6 — Codex scope is honest.** Current Codex supports trusted repo-local lifecycle hooks,
  so the kit ships `.codex/hooks.json` using the already-supported Codex payload shape.
  Project hooks run only after the project and exact hook definition are reviewed and trusted
  through `/hooks`. Codex documents incomplete `PreToolUse` interception for some
  `unified_exec` shell paths, so the hook remains best-effort: the `AGENTS.md` finalizer and
  opt-in same-repo CI enforcement are the backstops. No claim that the hook alone is a complete
  enforcement boundary.

## Scenarios

- **Given** an adopter repo with the workflow and its agent's producer hook, **when** the
  coding agent runs `git push` on a
  feature branch, **then** `hook pre-push` writes+pushes `refs/aireceipts/<slug>` before/with the
  push, the developer's push proceeds unblocked, and the next CI run posts the receipt.
- **Given** the same hook, **when** the agent runs any non-push Bash command (or `git status`,
  `git push --dry-run`, a tag-only push, or the nested `refs/aireceipts/*` push), **then** the hook
  does nothing and exits 0 — no ref written, no recursion.
- **Given** a session with no attributable receipt / no `git` / a failing ref push, **when** the
  hook fires on a branch push, **then** it exits 0 silently and the developer's push is unaffected.
- **Given** a repo already running the internal sibling's `refs/receipts` producer, **when** the
  aireceipts hook fires, **then** it writes to `refs/aireceipts/<slug>` (never `refs/receipts/*`),
  so both tools coexist and the docs state the coexistence is safe.

## Non-goals

- **Generating receipts in CI or changing the ref format.** Reuses SPEC-0065 `store=ref` verbatim.
- **A git `pre-push` hook for adopters.** The committed `.githooks/pre-push` stays this repo's own
  (not in the npm package); adopters use the agent hook (R3) or the manual command.
- **Complete enforcement from an agent hook alone.** Codex `PreToolUse` interception is
  incomplete for some shell paths; strict CI is the merge-time backstop (R6).
- **Blocking or gating a push on receipt success.** Structurally forbidden (R2).

## Test matrix

| Req | Case | Input | Expected |
|---|---|---|---|
| R1 | branch push (bare) | `{tool_name:"Bash",tool_input:{command:"git push"}}` | runs attach (`pr --store ref --push-ref`) |
| R1 | branch push origin | `git push origin feat` | runs attach |
| R1 | explicit refspec | `git push origin HEAD:refs/heads/main` | runs attach |
| R1 | chained or redirected branch push | `npm test && git push`, `git push 2>&1 \| tail -3` | runs one attach |
| R1 | non-git command | `npm test` | no action, exit 0 |
| R1 | git non-push | `git status` | no action |
| R1 | delete/tag-only/dry-run | `git push --delete`, `git push --tags`, `git push --dry-run` | no action |
| R1 | non-origin remote | `git push upstream feat` | no action (only origin) |
| R1 | nested receipts push (recursion) | `git push origin refs/aireceipts/x` | no action |
| R1 | echoed / heredoc / alias | `echo "git push"`, push inside a heredoc, alias | no action (tokenized parser, under-attach) |
| R1 | cwd-changing chain | `cd /elsewhere && git push`, `pushd /elsewhere && git push && popd` | no action (attach must target the hook's cwd) |
| R1 | repo-retargeting push | `git -C sub push …`, `git --git-dir=… push …`, `--work-tree`/`--namespace`/`--exec-path` | **no action** — the attach only runs against the hook's cwd, so a push aimed at another repo/worktree must not attach (would write the ref to the wrong repo) |
| R2 | never blocks | attach throws / no git / empty stdin / bad JSON / no session | exit 0, empty stdout, empty stderr, no decision object |
| R2 | zero stdout on success | valid branch push, attach succeeds | ref written; hook stdout is empty (runPrDetailed given no-op writers) |
| R3 | per-event entry | fresh + settings with an existing SessionEnd and/or PreToolUse entry | PreToolUse Bash entry added; SessionEnd `--mini` + unrelated keys untouched; idempotent |
| R4 | adopter kit | `docs/adopt/*` + `integrations` | workflow + Claude/Codex producer hooks documented; no-op-without-hook stated |
| R5 | collision note | kit docs | warns against enabling on a sibling-ref repo |
| R6 | Codex project hook | `.codex/hooks.json` + a Codex-shaped push payload | parses + acts; trust and `unified_exec` limits documented |

## Success criteria

- [x] `aireceipts hook pre-push` ships (hidden), parses the PreToolUse payload with the tokenized
      `gitWrite` parser, attaches the ref only on an `origin`/current-branch push, writes zero
      stdout, and exits 0 on every path (push never blocked; bounded delay only).
- [x] Per-event settings helpers land; the `.claude/settings.json` PreToolUse entry
      install/idempotency/coexistence with SessionEnd (and pre-existing PreToolUse entries) is
      tested; the workflow + agent-producer kit and `integrations` recipe document it, incl. the
      no-op-without-hook and the sibling-collision warnings.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, `node scripts/spec-lint.mjs` all pass unmasked.
