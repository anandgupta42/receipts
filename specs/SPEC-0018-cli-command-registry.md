---
id: SPEC-0018
title: "CLI command registry — kill the shared-file merge funnel"
status: approved
milestone: M3
depends: [SPEC-0001]
---

# SPEC-0018 · CLI command registry

Invariants: I1 (pure refactor — behavior byte-identical, no runtime network), I4
(local-first CLI), I5 (goldens/help bytes are contracts).

## Purpose

Today every new command or flag edits `src/cli/args.ts` and `src/cli/index.ts`, so
parallel specs collide in the same parser, help string, and dispatch switch. This spec
turns commands into package-local modules discovered deterministically, with shared
parsing and lifecycle seams explicit enough that adding a command edits its own file and
tests, not a central funnel. **Kill criterion:** after this lands, two branches that
each add one command merge conflict-free and have zero overlapping production files.

## Requirements

- **R1 — Self-contained command modules with no shared registry edit.** Each command
  lives in `src/cli/commands/<name>.ts` and exports one `CommandDef`. The command set is
  discovered deterministically from package-local command modules in sorted filename
  order; there is no committed `registry.ts` import list and no generated registry file
  that feature branches edit. If the current `tsup` bundle cannot preserve that module
  discovery in the published package, the implementation must change the CLI build
  shape so discovery still works from installed package files, without reintroducing a
  shared source-file touchpoint.
- **R2 — Parser models current command selection, not just `flags[]`.** The registry
  metadata must represent command-selecting flags (`--help`, `--methodology`,
  `--telemetry-show`, `--check-budget`, `--quota`, `--mini`, `--list`, `--handoff`),
  positional subcommands (`compare`, `benchmark`, `install-hook`, `uninstall-hook`,
  `statusline`, `templates`, `week`, `pr`), and the default receipt selector. Selection
  precedence remains byte-for-byte compatible with today's `parseArgs`: help before
  hidden info commands, then budget/quota selectors, then positional subcommands, then
  list/handoff/default receipt. Shared output-mode flag groups (`--json`,
  `--csv[=session|tool]`, `--svg`, `--png`, `--theme`, `-o/--output`, `--template`) and
  scoped options (`--since`, `--by-project`, `--handoff-threshold`, `--dry-run`,
  `--post`, `--session`) remain accepted or ignored by the same commands as today; this
  refactor does not add new incompatibility errors.
- **R3 — Command modules run through an explicit context.** `CommandDef.run` receives a
  `CommandContext` rather than reaching through globals by default:
  `{ stdin, stdout, stderr, env, cwd, now, fs, prompt, telemetry }`, with the minimal
  methods needed by current commands. `quota` keeps injectable stdin, hook install
  keeps injectable prompt/filesystem seams, and commands stay unit-testable without
  mutating process globals.
- **R4 — Help assembly is byte-safe.** Help metadata includes `helpOrder`, `section`,
  `hidden`, and literal `helpLines`. The current curated help layout, output-mode
  footer, and hidden-but-parseable `telemetry-show`/`methodology` commands are preserved.
  Add a pre-refactor `goldens/cli/help.txt`; post-refactor `aireceipts --help` must be
  byte-identical to it.
- **R5 — Parallel-safety proof uses git, not synthetic assertions.** Add a temp
  git-worktree test that starts from the same baseline, creates branch A adding
  `src/cli/commands/a.ts`, creates branch B adding `src/cli/commands/b.ts`, merges both,
  and asserts no conflict plus the exact promised changed-file set: the two new command
  files and their tests only, no `args.ts`, `index.ts`, registry, generated registry, or
  central help file.
- **R6 — Telemetry lifecycle remains one wrapper.** Parsing, command selection, command
  execution, telemetry recording, first-run notice, and bounded flush remain owned by
  `main()`. Lifecycle tests cover parse failure, command throw, command nonzero exit,
  command success, and `telemetry-show`: exactly one run/error event as appropriate for
  real commands, and `flushTelemetry()` awaited for them. **`telemetry-show` is the sole
  exception on all three axes** — no first-run notice, no `cli_run`/`cli_error` record,
  and no flush — because it is the preview-what-would-be-sent command and must itself
  send nothing (SPEC-0002 R5 governs; the scenario below has always said so, and a
  fetch-spy test with telemetry *enabled* proves it).
- **R7 — Shared helpers are allowed under common ownership.** Commands may import
  shared CLI helpers from explicit common modules such as `src/cli/common/*` or existing
  domain modules. The rule is not "commands never import helpers"; the rule is that a
  new command must not edit another command's owned module or a central funnel.
- **R8 — Preservation coverage exists before the refactor lands.** Snapshot the current
  command inventory and add pre-refactor CLI coverage for parse precedence, help bytes,
  stdout/stderr/exit behavior, SVG/PNG/JSON/CSV modes, compare error cases, no-session
  cases, quota stdin, hook prompt seams, statusline stdin fallback, hidden commands, and
  accepted-but-ignored output flags. Renderer/SVG goldens alone are not enough proof for
  this refactor.

## Scenarios

- **Given** two sibling specs each adding a command module, **when** both branches merge
  into the baseline, **then** git reports no conflicts and no overlapping production
  file edits.
- **Given** `aireceipts --help`, **when** help is assembled from modules, **then** the
  bytes match `goldens/cli/help.txt` exactly and hidden commands stay hidden.
- **Given** `aireceipts compare a b --svg -o compare.svg`, **when** parsing runs through
  registry metadata, **then** command selection and output-mode options match today's
  `parseArgs` result.
- **Given** `aireceipts --telemetry-show`, **when** `main()` runs, **then** no first-run
  notice is printed, no telemetry is sent, and the payload is printed as today.
- **Given** a command throws, returns 1, or succeeds, **when** `main()` exits, **then**
  telemetry is recorded/flushed exactly as the current lifecycle contract requires.

## Non-goals

New CLI behavior of any kind; plugin loading from outside the package; runtime network
discovery; changing flag spellings; banning shared helpers; changing telemetry payload
schema; changing receipt/compare/rendering output.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 discovery | installed-package command directory | deterministic sorted command set |
| R1 no shared file | branch adds one command | production diff excludes parser/dispatcher/registry funnels |
| R2 selectors | all command-selecting flags + subcommands | same selected command as pre-refactor |
| R2 precedence | conflicting selectors such as `--help --quota compare a b` | same precedence as current parser |
| R2 shared flags | `--svg`, `--png`, `--theme`, `-o`, `--json`, `--csv`, `--template` | same accept/ignore/error behavior by command |
| R3 context | quota stdin, hook prompt/fs, statusline stdin | injectable seams, no process-global-only tests |
| R4 help bytes | `--help` | byte-identical to `goldens/cli/help.txt` |
| R4 hidden commands | `--telemetry-show`, `--methodology` | parseable but absent from help |
| R5 git proof | two temp branches adding commands | conflict-free merge, exact changed-file set |
| R6 parse failure | malformed argv | error recorded, flush awaited |
| R6 command throw | test command throws | error recorded once, stderr written, flush awaited |
| R6 nonzero/success | commands return 1 / 0 | run recorded once with `ok` false/true |
| R6 telemetry-show | `--telemetry-show` | first-run notice skipped, payload printed, no send |
| R7 helpers | command imports common helper | allowed |
| R7 cross-command edit | command edits sibling command module | test/review gate rejects |
| R8 preservation | CLI coverage suite | stdout/stderr/exit/goldens unchanged |

## Success criteria

- [ ] Pre-refactor CLI snapshots and tests from R8 are committed before the registry
      migration diff, so behavior drift is visible.
- [ ] The R5 temp git-worktree test proves two independently added commands merge with
      zero overlapping production files.
- [ ] `git log --stat` for the first two command-adding specs after this shows no
      overlapping production files.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, and `node scripts/spec-lint.mjs` all pass
      unmasked (`echo $?`), with receipt/help bytes intentionally unchanged.

## Validation

**2026-07-02 · S2 (Codex): REWORK → draft reworked.** Applied all 8 critic findings:
removed the shared registry touchpoint via deterministic package-local discovery;
modeled selector flags, positional subcommands, shared output flags, precedence, and
accepted-but-ignored compatibility; added `CommandContext`; made help assembly
byte-safe with order/section/hidden metadata and a help golden; replaced the synthetic
parallel proof with a temp git-worktree merge test; required telemetry lifecycle tests
for parse failure, throws, nonzero exits, success, and `telemetry-show`; allowed shared
helpers while forbidding cross-command ownership edits; and required pre-refactor CLI
coverage beyond renderer goldens. Status remains draft pending maintainer approval.
