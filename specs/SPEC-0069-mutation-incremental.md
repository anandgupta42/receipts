---
id: SPEC-0069
title: "Mutation testing — incremental PR runs, nightly full sweep"
status: shipped
milestone: M5
depends: [SPEC-0044]
---

# SPEC-0069: Mutation testing — incremental PR runs, nightly full sweep

## Purpose

The `Mutation` job (Stryker on `src/pricing/**` + `src/pr/**` — the money paths' anti-gaming
moat, SPEC-0044 M3) runs ~40 minutes on every PR that touches those trees, testing ~4,300
mutants exhaustively. 84% of that surface is `src/pr` comment/receipt *rendering*, where
mutation testing has the worst signal-to-noise (equivalent mutants in string/formatting
code depress the score with noise, not real test gaps — and the rendered strings are
already byte-pinned by golden + exact-string tests). This spec keeps the moat exactly as
strong on the money paths while removing the wasted time: PR runs go **incremental**
(reuse prior mutant results, re-run only changed code) and the exhaustive full sweep moves
to a **nightly** job that also refreshes the shared baseline. It changes *what executes*,
never *what is mutated or gated* — no mutator is dropped, so coverage is identical.
Empirically validated: Stryker's own incremental example reuses 94% of mutants, and a
local reuse run dropped a module from 4m32s to 16s. Serves the AGENTS.md gate rationale
(agent tests reach ~100% coverage but weaker mutation scores) — faster proof, not less
proof, on the money paths.

## Requirements

- **R1** — `stryker.config.json` enables incremental mode: `"incremental": true`,
  `"incrementalFile": "reports/stryker-incremental.json"`. Stryker reuses a KILLED
  mutant when its culprit test is unchanged, and a SURVIVED mutant when no test changed
  and no new test covers it; changed code re-runs. A full report is still produced every
  run — incremental changes *what executes*, never *what is reported or gated*.
- **R2** — The PR `Mutation` job (`on: pull_request`, paths `src/pricing/**`,
  `src/pr/**`) restores the incremental baseline from cache (read-only, `restore-keys`
  prefix) and runs `npx stryker run --incremental`. It stays **advisory** (not a required
  check) and keeps the existing empty-`src/pricing` and missing-config guards. A cold
  cache (before any nightly has populated one) degrades gracefully to a full run.
- **R3** — A **nightly** job (`on: schedule` + `workflow_dispatch`, **guarded to the
  default branch** so only `main` writes the shared baseline) runs the exhaustive full
  sweep with `npx stryker run --incremental --force` (re-tests every mutant AND rewrites a
  fresh baseline), then saves `reports/stryker-incremental.json` to cache under a key PRs
  restore via prefix. Running on the default branch, its cache is readable by PR branches.
  This bounds incremental staleness to ≤1 day and keeps a daily exhaustive guarantee on
  the money paths. It keeps the same empty-`src/pricing` and missing-config guards as the
  PR job.
- **R4** — No mutator is disabled and the `src/pricing` + `src/pr` mutate scope and the
  `break: 60` floor are unchanged. Every mutant Stryker generates today is still
  generated, still tested (on the nightly full sweep, or on a PR when its code/tests
  changed), and still gated — the money-path coverage is byte-for-byte identical; only
  the *scheduling* of when each mutant runs changes. No product code changes.

## Scenarios

- **Given** a PR touching one `src/pr` file with a warm cached baseline **When** the
  Mutation job runs **Then** only mutants in changed code (and mutants whose covering
  tests changed) execute; the rest are reused; wall clock is a few minutes, not ~40.
- **Given** the nightly schedule fires **When** the job runs **Then** every mutant is
  re-tested (`--force`), a fresh baseline is written and cached, and a score below
  `break: 60` fails the job.
- **Given** a mutated arithmetic, conditional, or string-literal mutant anywhere in the
  money paths **When** the nightly sweep runs (or a PR touches its code/tests) **Then** it
  is still generated and must be killed — no mutator is disabled, so the moat is intact.
- **Given** a cold cache (no prior nightly) **When** a PR Mutation job runs **Then**
  `--incremental` builds the baseline from scratch (full run) and the job still reports
  a score — no failure from a missing incremental file.
- **Given** a `workflow_dispatch` on a non-default ref **When** it fires **Then** the
  nightly job does not run — only `main` writes the shared baseline.

## Non-goals

- A score-ratchet (fail only if the score drops vs a stored main baseline): StrykerJS has
  no native mechanism; the fixed `break: 60` floor stays. Deferred (would need custom
  baseline-diff scripting).
- Trimming cosmetic mutators (`ignoreStatic`, `mutator.excludedMutations: ["StringLiteral"]`):
  **considered and rejected.** Both are global-only in Stryker — they cannot be scoped to
  rendering files — and both drop real money-path mutants: `ignoreStatic` would ignore
  static arithmetic like `src/pr/select.ts`'s `OVERLAP_SLACK_MS = 15 * 60 * 1000`
  (an attribution window), and excluding `StringLiteral` would drop the model-prefix /
  vendor-id routing literals in `src/pricing/resolve.ts` that choose the price table.
  Incremental + nightly delivers the speedup without that coverage tradeoff.
- Narrowing the `src/pr` mutate glob to only its numeric/attribution files: kept whole so
  the nightly sweep still scores rendering. A future spec may narrow if the nightly full
  run itself becomes too slow.
- Cross-machine sharding across a CI matrix: StrykerJS has no native support (issue #2707,
  closed stale); incremental + nightly is expected to suffice. Revisit only if the nightly
  full run itself becomes too slow.
- Making Mutation a required check: it stays advisory, as today.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 incremental reuse | 2nd run, unchanged file | prior results reused; wall clock collapses (locally 4m32s → 16s) |
| R2 PR job | PR touching src/pricing/** or src/pr/** | restores baseline, runs `--incremental`, advisory, guards intact |
| R2 cold cache | PR before any nightly | full run, score reported, no missing-file failure |
| R3 nightly | schedule / workflow_dispatch on main | `--incremental --force` full sweep, fresh baseline saved to cache |
| R3 dispatch off main | workflow_dispatch on a side ref | nightly job skipped (no baseline write) |
| R4 no mutator dropped | any pricing/pr mutant (arithmetic, conditional, StringLiteral, static) | still generated + gated (attribution.ts scored 81.60% locally) |
| R4 floor unchanged | combined score < 60 | job fails (break threshold) |

## Success criteria

- [x] `stryker.config.json` valid; a scoped local run passes ≥ `break` (attribution.ts
      81.60% confirmed) and incremental reuse demonstrably reuses prior results.
- [x] `.github/workflows/mutation.yml` has a PR incremental job + a nightly full-sweep
      job, cache restore/save wired, actions SHA-pinned, `actionlint`/`zizmor` clean.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, `node scripts/spec-lint.mjs`,
      `node scripts/hygiene.mjs` all pass unmasked (`echo $?`) — no product code changed.
