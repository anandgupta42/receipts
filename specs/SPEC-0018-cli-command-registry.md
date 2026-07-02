---
id: SPEC-0018
title: "CLI command registry — kill the shared-file merge funnel"
status: draft
milestone: M3
depends: [SPEC-0001]
---

# SPEC-0018 · CLI command registry

Invariants: I1 (pure refactor — behavior byte-identical, goldens must not change), I5.

## Purpose

Today every new command or flag edits the same two files: `src/cli/args.ts` (one
growing `ParsedArgs` union + one flag loop + one return-shape per command) and
`src/cli/index.ts` (one growing HELP string + one growing dispatch switch). During the
2026-07-02 parallel build wave, **every pair of concurrently-built specs conflicted in
exactly these two files, and every merge re-conflicted every open PR** — hours of lead
time spent on mechanical rebases. In an agents-build-in-parallel repo, shared-file
growth is an architecture bug, not an inconvenience. **Kill criterion:** after this
lands, two specs each adding a command must produce zero overlapping-file edits (proved
by the R4 test).

## Requirements

- **R1 — Self-contained command modules.** Each command lives in
  `src/cli/commands/<name>.ts` exporting a `CommandDef`: `{ name, flags[], helpLines,
  parse(own-args) → own typed options, run(options) → exit code }`. Adding a command =
  adding ONE file + ONE line in `src/cli/commands/registry.ts` (a sorted import list —
  the only shared touchpoint, one line per command, order-insensitive).
- **R2 — Generic arg parser.** `args.ts` shrinks to a generic tokenizer that consults
  the registry's flag declarations; the per-command option types live in the command's
  own module (no global `ParsedArgs` union).
- **R3 — Help is assembled.** `--help` output is generated from each module's
  `helpLines` in registry order — byte-identical to today's help text (golden-tested).
- **R4 — Parallel-safety proof.** A test adds two synthetic commands via two synthetic
  modules and asserts registration works with no edits outside their own files +
  their registry lines. This is the spec's reason to exist, tested.
- **R5 — Migration completeness.** All existing commands (receipt, list, compare,
  handoff, week, quota, statusline, mini, install/uninstall-hook, telemetry-show,
  methodology, help) migrate; `main()` keeps its telemetry lifecycle wrapper; every
  existing CLI test passes unchanged (contract preserved).

## Scenarios

- **Given** two new sibling specs each adding a command, **when** both branches merge,
  **then** git reports no conflicting files (registry lines merge cleanly — different
  lines).
- **Given** the migration, **when** goldens + CLI tests run, **then** all byte-identical
  / green with zero test edits.

## Non-goals

New CLI behavior of any kind; plugin loading from outside the package (the registry is
static, I1); changing flag spellings.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 module shape | each migrated command | exports CommandDef, no imports from other commands |
| R2 parser | existing CLI test suite | passes unchanged |
| R3 help | --help | byte-identical to pre-refactor golden |
| R4 parallel proof | two synthetic command modules | both registered, zero shared-file edits beyond one registry line each |
| R5 goldens | full corpus | byte-identical |

## Success criteria

- [ ] `git log --stat` for the two specs merged after this shows no overlapping files.
- [ ] Unmasked gate green; goldens byte-identical (I1 refactor proof).

## Validation

*(pending /validate-spec)*
