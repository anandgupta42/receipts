---
id: SPEC-0043
title: "Day-1 setup and integration kit"
status: shipped
milestone: M5
depends: [SPEC-0036, SPEC-0037]
---

# SPEC-0043 · day-1 setup and integration kit

Source research: `docs/internal/research/2026-07-04-day-1-integration-strategy.md`.

Invariants: I1 (setup/integration inspection is deterministic; no model calls; no
network in the product path), I2 (setup never fabricates dollars; tokens-only stays
tokens-only), I3 (every displayed number comes from the existing receipt/week models),
I4 (all transcript reading stays local; optional writes are consent-gated; no transcript
upload), I5 (new user-facing output is fixture/golden gated where stable), I6 (the
integration kit reports facts and options, never ranks assistants or models).

Two non-negotiables restated for this milestone: **deterministic, zero model calls** and
**evidence, not judgement**. The setup command may say what sessions were found, what
cost they rendered to, and what integrations are available. It must not say an assistant
is better/worse, a workflow is correct, or a PR is ready.

## Purpose

Turn the launch story from "read docs, pick a plugin or hook, maybe use PR receipts
later" into one local command:

```sh
npx aireceipts-cli setup
```

The command must show value before asking for trust: detect local agent sessions, show a
latest-session cost summary, show the trailing-week total, then offer optional local
integrations. A second command, `npx aireceipts-cli integrations [target]`, prints exact
assistant/repo snippets. Plugins, hooks, statuslines, rules, and PR workflows become
thin wrappers around the CLI, not the product core.

## Motivation

SPEC-0037 made `npx aireceipts-cli pr --post` the one command for PR-producing tasks, and
SPEC-0036 made PR receipt checks visible without failing by default. That is right for
team accountability, but it is the wrong first interaction for many users: day 1 may be
a local experiment, a docs edit, a private repo, or a session with no PR. Those users
still need an immediate receipt, week total, and next-action guidance.

The research found the same shape across current assistant ecosystems: plugins and hooks
exist, but their packaging and trust models differ. Codex and Claude Code use skills and
plugins as distribution layers; OpenCode plugins are TypeScript/JavaScript event modules;
Cursor exposes rules, Agent Skills, MCP, and CLI surfaces. The portable artifact is the
deterministic CLI command. Everything assistant-specific should call that command.

## Requirements

- **R1 - One setup command after package publication.** Docs and onboarding name
  `npx aireceipts-cli setup` as the recommended first command for the current published
  package (`package.json:2`, `package.json:9-11`). The installed/local bin command is
  `aireceipts setup`. If a future release claims the shorter `aireceipts` npm package,
  docs can switch to `npx aireceipts setup`; do not claim a literal `npx aireceipts`
  path while that package name is not the published package.
- **R2 - Show value before config.** `setup` first prints a read-only report:
  discovered supported-agent session counts, the latest session's source/model/cost-or-
  tokens/waste summary, and the trailing-week priced/token total. It must compute those
  numbers through the existing adapter/session loaders (`src/parse/load.ts:18-40`), the
  same receipt model path used by the receipt command (`src/cli/commands/receipt.ts:19-74`),
  and the same week digest path (`src/aggregate/week.ts:297-312`).
- **R3 - No-session path is still useful.** If no supported sessions are found, `setup`
  exits 0 and prints the searched roots through the existing no-session machinery
  (`src/cli/common/session.ts:10-15`, `src/parse/load.ts:67-72`), plus the next command
  to run after creating a session. It must not make users configure hooks before a
  transcript exists.
- **R4 - Optional writes are explicit, diffed, and reversible.** Setup may offer local
  integration writes only after the read-only report. Each write prints the exact diff,
  asks for confirmation, and has an undo command or exact manual undo text. The Claude
  Code hook path must reuse or delegate to `installHook`/`uninstallHook`
  (`src/hook/install.ts:55-122`) and the settings parser/diff primitives
  (`src/hook/settings.ts:41-51`, `src/hook/settings.ts:151-191`).
- **R5 - No network or external posting from setup.** `setup` never calls GitHub, never
  posts a PR comment, never checks npm, and never uploads transcripts. PR posting remains
  the explicit SPEC-0037 command (`src/cli/commands/pr.ts:7-15`), and repo CI adoption
  remains the SPEC-0036 notice-only reusable workflow unless maintainers opt in.
- **R6 - Integration recipes are first-class.** `integrations` prints exact snippets for
  `claude-code`, `codex`, `opencode`, `cursor`, and `github`. With no target it prints a
  matrix. Every recipe states: what works today, one command/snippet, files changed, undo
  path, scope (local/user/repo/external), and whether network is involved.
- **R7 - Assistant wrappers are thin.** Any generated `AGENTS.md`, `CLAUDE.md`,
  `.opencode/commands/receipt.md`, `.cursor/skills/aireceipts/SKILL.md`,
  `.agents/skills/aireceipts/SKILL.md`, or `.claude/skills/aireceipts/SKILL.md` must
  instruct the assistant to run `npx aireceipts-cli`, `npx aireceipts-cli week`, and,
  for PR-producing tasks only, `npx aireceipts-cli pr --post`. They must not duplicate
  parsing, pricing, attribution, or policy logic.
- **R8 - Command surface fits the existing registry.** `setup` and `integrations` land
  as ordinary `CommandDef` modules with help entries. They are selected through the
  existing command registry (`src/cli/types.ts:49-56`,
  `src/cli/registry.ts:42-76`) and appear in assembled help
  (`src/cli/help.ts:37-47`). Do not add a second dispatcher.
- **R9 - Machine-readable output for tests and future UI.** `setup --json` and
  `integrations --json` emit stable JSON for the read-only report and recipe matrix.
  JSON output must not include local transcript paths, repo names, prompt text, or
  dollar amounts beyond the same priced totals already allowed by receipt output.
- **R10 - Docs choose by user intent, not assistant brand.** README and guide docs get a
  "Choose your integration" page that starts with `npx aireceipts-cli` /
  `npx aireceipts-cli setup`, then routes to local hook/statusline, assistant snippets,
  budget, and PR receipt rollout. PR receipts remain later/team adoption, not the
  first-day requirement.

## Scenarios

- **Given** a machine with Claude Code, Codex, OpenCode, and Cursor transcripts,
  **when** the user runs `npx aireceipts-cli setup`, **then** the first screen shows counts
  by supported agent, a latest-session cost-or-token summary, and a week total before
  any prompt to write settings.
- **Given** a machine with no supported transcripts, **when** setup runs, **then** it
  lists searched roots, says no setup is required yet, and exits 0.
- **Given** a Claude Code user chooses the SessionEnd mini-receipt option, **then** setup
  shows the settings diff, asks before writing, and the undo path is
  `npx aireceipts-cli uninstall-hook`.
- **Given** a user asks for the OpenCode integration recipe, **when** they run
  `npx aireceipts-cli integrations opencode`, **then** they get a `.opencode/commands`
  snippet first; any OpenCode plugin is clearly labeled future/optional unless it exists.
- **Given** a Cursor user asks for integration, **then** the recipe uses `AGENTS.md` and
  `.cursor/skills` instructions, not a claimed lifecycle hook.
- **Given** a maintainer asks for GitHub integration, **then** the recipe prints the
  SPEC-0036 reusable workflow caller and names notice-only default plus opt-in
  enforcement.
- **Given** setup runs in CI or with `--json`, **then** it does not prompt and does not
  write files.

## Non-goals

- **Publishing npm itself.** This spec blocks day-1 docs from overclaiming before npm
  exists, but the release/auth act is owned by the release process.
- **Universal plugin package.** There is no one plugin API across Claude Code, Codex,
  OpenCode, and Cursor. This spec ships recipes/snippets and leaves assistant-specific
  plugin packages to later specs.
- **Automatic PR posting from hooks or setup.** External writes stay explicit through
  `npx aireceipts-cli pr --post`.
- **CI receipt generation.** CI checks for marked comments only; transcripts stay local
  by SPEC-0036/SPEC-0037.
- **Cost enforcement.** Setup may point to `--check-budget`, but it does not stop
  agents. Budget output remains advisory (`src/cli/commands/check-budget.ts:6-19`).
- **Assistant or model ranking.** The matrix is about integration capability, not which
  assistant is best.
- **New pricing/provider semantics.** Unknown provider/model prices still render
  tokens-only; this spec adds no price fallback.

## Design

Add two command modules:

- `src/cli/commands/setup.ts`, `matches(options.positional[0] === "setup")`.
- `src/cli/commands/integrations.ts`, `matches(options.positional[0] === "integrations")`.

They should follow the current command module contract (`src/cli/types.ts:49-56`) and
let the registry discover them (`src/cli/registry.ts:42-76`). Existing global flags are
enough for the first slice: `--json` is already parsed (`src/cli/options.ts:56-175`),
and `--dry-run` can mean "show diffs/snippets but write nothing." Any further flags must
be registered in `parseOptions`; do not hide behavior in unparsed positionals except the
integration target name.

Create a small pure integration layer, likely under `src/setup/`. Its data contract is
plain JSON-serializable state, not a renderer:

| Field | Shape | Notes |
|---|---|---|
| `agents` | rows keyed by `AgentSource` with session count, priced count, token total | Agent ids come from the adapter registry (`src/parse/registry.ts:11-23`). |
| `latest` | optional source/id/label/cost-or-tokens/waste-count row | Computed from the existing receipt model, not a new calculator. |
| `week` | optional session count, priced total when available, token total | Computed by `buildWeekDigest` (`src/aggregate/week.ts:297-312`). |
| `offers` | rows with id, scope, files written, network behavior | Used by text and JSON output so recipes stay in one place. |

The report uses `listFullSessions()` for session discovery (`src/parse/load.ts:18-40`),
`agentIds()`/`adapters()` for supported-agent names (`src/parse/registry.ts:11-23`),
`buildReceiptModel` through the same path the receipt/mini/statusline commands use
(`src/cli/commands/receipt.ts:19-74`, `src/cli/commands/mini.ts:11-27`,
`src/cli/commands/statusline.ts:73-89`), and `buildWeekDigest()`
(`src/aggregate/week.ts:297-312`). Do not add a second receipt calculator or week
aggregator.

Setup output order is part of the UX contract:

1. Found sessions by agent.
2. Latest-session summary or no-session roots.
3. Week summary when sessions exist.
4. Optional integrations, with local-only options first.
5. Exact next commands.

For Claude Code, setup can delegate hook installation to `installHook` because it
already validates JSON, prints a diff, asks for confirmation, backs up once, and writes
atomically (`src/hook/install.ts:55-95`). Statusline installation should reuse the same
settings parser/serializer/diff helpers (`src/hook/settings.ts:41-51`,
`src/hook/settings.ts:151-191`) and add only a `statusLine` command entry. If a
statusline entry already exists, setup prints a manual snippet rather than overwriting
it.

For assistant snippets, keep files as static templates owned by the package, with one
canonical instruction:

```text
When you finish a coding session, run `npx aireceipts-cli` and summarize the receipt in the handoff.
Before you finish a PR-producing task, run `npx aireceipts-cli pr --post` from the repo worktree and include any failure message in the handoff.
Never guess cost. If aireceipts reports tokens-only, preserve that.
```

`integrations github` prints the existing SPEC-0036 caller from
`docs/adopt/pr-receipt-check-caller.yml` and links to `docs/pr-receipts.md`. It must say
CI is notice-only by default, same-repo enforcement is opt-in, fork PRs stay advisory,
and CI never generates receipts.

Docs change:

- README install/usage moves `npx aireceipts-cli setup` directly after
  `npx aireceipts-cli`.
- `docs/guide/01-getting-started.md` becomes receipt -> setup -> week -> optional
  automation.
- New `docs/guide/10-integrations.md` (or equivalent) carries the "Choose your
  integration" matrix from the research.
- `docs/pr-receipts.md` remains the PR-specific path and links back to setup rather than
  becoming the first-run guide.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 package docs | current `aireceipts-cli` package | docs use `npx aireceipts-cli setup` and name `aireceipts setup` as the installed-bin form |
| R2 multi-agent setup | staged Claude/Codex/OpenCode/Cursor summaries | counts by agent, latest summary, week total before offers |
| R2 priced/token honesty | latest session has unknown model price | tokens-only line, no fabricated `$` |
| R3 no sessions | empty home/config roots | searched roots + next action, exit 0 |
| R4 Claude hook yes | user selects hook install | diff shown, confirmation required, settings written only after yes |
| R4 Claude hook no | user declines | no file write, exit 0 |
| R4 statusline existing | settings already has `statusLine` | no overwrite; manual snippet printed |
| R5 no network | setup with all options except explicit PR command | no `gh`, npm, HTTP, or transcript upload calls |
| R6 integration matrix | `integrations` | table includes claude-code, codex, opencode, cursor, github |
| R6 target recipe | `integrations opencode` | `.opencode/commands` snippet; plugin not required |
| R6 unknown target | `integrations unknown` | exit 1 with supported target names |
| R7 snippets | generated assistant files | all call CLI; no pricing/parser logic |
| R8 help | `--help` | setup/integrations listed with concise descriptions |
| R9 JSON setup | `setup --json` | stable schema, no paths/prompts/repo names |
| R9 JSON integrations | `integrations --json` | stable recipe matrix |
| R10 docs | README/user guide/integration guide | first-run path is CLI/setup; PR receipts are optional team rollout |

## Success criteria

- [x] `npx aireceipts-cli setup` exists in the built CLI and shows concrete value before
      any write prompt.
- [x] `npx aireceipts-cli integrations [target]` exists and prints tested recipes for
      Claude Code, Codex, OpenCode, Cursor, and GitHub.
- [x] Setup no-session and multi-session paths are covered by unit tests and built-CLI
      e2e tests.
- [x] Setup/integration commands are read-only; the existing Claude hook write path
      remains diffed, consent-gated, and reversible through `install-hook` /
      `uninstall-hook`.
- [x] Assistant snippets are tested to contain only CLI instructions, not duplicated
      business logic.
- [x] Docs include the integration matrix and keep PR receipts as optional/team rollout.
- [x] Acceptance testing performed live: source-checkout equivalent of
      `npx aireceipts-cli setup`, `npx aireceipts-cli setup --json`,
      `npx aireceipts-cli integrations`, and one target recipe, with command output
      captured in the PR.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, and `node scripts/hygiene.mjs` all pass unmasked
      (`echo $?`).

## Decisions

- **Statusline setup:** print recipe guidance only; do not write or overwrite
  `statusLine` config in this milestone.
- **Assistant snippets:** print recipes through `integrations`; do not write snippet
  files from setup.
- **`setup --json` privacy:** do not include latest session id, title, transcript path,
  repo name, or prompt-like content. The JSON report keeps source/model/totals/offers
  only.
- **OpenCode packaging:** ship the `.opencode/commands` recipe now; leave a dedicated
  OpenCode plugin package to a later spec if setup proves the funnel.
- **Integration docs path:** `docs/guide/15-integrations.md`, linked from README and
  `docs/guide/01-getting-started.md`.

## Validation

**2026-07-04 · S1 (self):** This draft keeps the research's core recommendation: CLI
first, setup second, hooks/statuslines as optional local convenience, plugins/skills as
thin wrappers, PR receipts as explicit/team rollout. It preserves I1/I4 by forbidding
setup network calls and external posting, and it grounds the implementation in existing
CLI/adapter/receipt/week/hook seams.

**2026-07-04 · S2 (implementation):** Shipped `setup` and `integrations` through the
existing command registry, a pure `src/setup/` report/recipe layer, README/getting-started
docs, and `docs/guide/15-integrations.md`. Built-CLI acceptance passed for `setup`,
`setup --json`, `integrations`, and `integrations opencode` against a sandboxed fixture
home. The slow opencode stress path was reduced in the default suite: built-CLI keeps
fixture-scale receipt coverage, parser stress validates the 24-case structural cycle by
default, and `AIRECEIPTS_SLOW_OPENCODE=1` expands that bounded-shape run to 100 cases.
