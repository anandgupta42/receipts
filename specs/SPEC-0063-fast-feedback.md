---
id: SPEC-0063
title: "Fast feedback — cut test, CI, and release wall-clock without weakening any gate"
status: shipped
milestone: M5
depends: []
---

# SPEC-0063: Fast feedback — cut test, CI, and release wall-clock without weakening any gate

## Purpose

The verification loop is the pacing item for every feature: the local suite runs ~58s
(1,535 tests summing to ~247s of test time at ~58% CPU), the CI `verify` job ~85s, and
the full release preflight ~90–110s — almost all of it waste, not coverage. Three root
causes, all measured: (1) `src/parse/sqlite.ts` prefers the `sqlite3` CLI, so every
query is a `spawnSync` — the slowest test file spends 24s at 15% CPU blocked on spawns,
and the spawn storm slows every other fork; (2) `scripts/verify-goldens.mjs` recompiles
all of `src/` with `tsc` on every invocation, and the determinism gate re-runs it 10× —
ten identical compiles (36s of every CI run); (3) `preflight-release.mjs` runs its ~10
independent gates strictly serially. This spec removes the waste while keeping every
gate exactly as strong — same commands, same coverage, byte-identical output (serves
I1/I5: determinism is proven more often per minute, not less).

## Requirements

- **R1** — `openReadOnly` prefers in-process `node:sqlite` and falls back to the
  `sqlite3` CLI only when `node:sqlite` is unavailable (Node 20, or Node 22 before
  22.13 without `--experimental-sqlite`). The `sqlite3 -version` probe result is cached
  per process. Both readers keep the same error contract: a failing query (missing
  table, schema drift) yields `[]`, never a throw — Node 20 and Node 22 behave
  identically on malformed databases.
- **R2** — When `node:sqlite` is used, Node's `ExperimentalWarning` for SQLite (which
  embeds the PID) never reaches stderr: a process-wide, idempotent `emitWarning` filter
  — installed once before the first import, never uninstalled, safe under concurrent
  adapter discovery — suppresses exactly that warning and nothing else.
- **R3** — Receipt output stays byte-identical on both reader paths.
  `test/parse/sqlite.test.ts` proves it end-to-end: it renders the full opencode
  receipt (real adapter SQL — `json_extract`/`json_each` aggregates, message loading)
  once through the sqlite3-CLI reader and once through `node:sqlite` and asserts the
  two receipts are byte-identical, plus direct reader-level checks (real-data reads and
  the `[]`-on-error contract). So the fallback stays covered even though CI runs a
  single Node version (see the CI-matrix note under Non-goals).
- **R4** — `verify-goldens.mjs` keeps its exact CLI contract (same invocation, same
  output, argv passthrough) but caches the compiled output under
  `node_modules/.cache/aireceipts-goldens/<hash>`, keyed by the content of every
  compiler input (sorted file list + contents of `src/**/*.ts` and `scripts/goldens.mts`,
  the generated tsconfig, the TypeScript version, `package.json` `"type"`) plus
  `data/**`. Cache entries are immutable once written (temp-dir build + atomic rename,
  loser of a concurrent race adopts the winner's entry or runs from its own temp dir);
  a missing sentinel or missing compiled entrypoint invalidates the entry (corrupt
  entries are evicted); any cache failure falls back to today's fresh-compile
  behavior. Entries not matching the current key are pruned after 7 days.
- **R5** — `determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs` remains
  the determinism gate, unchanged; with a warm cache the 10 runs byte-match trivially
  and complete in seconds, not ~36s.
- **R6** — `preflight-release.mjs` runs `build` → tarball-shape first (the only
  `dist/` writer/reader pair outside vitest), then all remaining gates concurrently
  (tsc, eslint, cite-check, spec-lint, hygiene, goldens → determinism, full vitest).
  Per-gate output is buffered; the pass/fail summary prints in a fixed order. The set
  of gates, their commands, and `--quick` semantics are unchanged.
- **R7** — No gate is removed, no timeout raised, no test skipped, and AGENTS.md's
  verification block still passes verbatim.

## Scenarios

- **Given** Node ≥ 22.13 **When** any adapter opens a transcript DB **Then** queries run
  in-process via `node:sqlite`, stderr carries no ExperimentalWarning, and the rendered
  receipt is byte-identical to the sqlite3-CLI rendering of the same transcript.
- **Given** a runtime without `node:sqlite` (Node 20, or Node 22 before it was
  built in) **When** the same DB is opened **Then** the sqlite3 CLI fallback is used
  and returns rows identical to the `node:sqlite` path.
- **Given** two concurrent `verify-goldens.mjs` runs on a cold cache **When** both
  compile **Then** one entry wins the rename, both runs verify successfully, and no
  partially-written entry is ever read (sentinel).
- **Given** any edit to `src/`, `scripts/goldens.mts`, or `data/**` **When**
  `verify-goldens.mjs` runs **Then** the key changes and a fresh compile occurs.
- **Given** a red gate (e.g. a failing test) **When** `preflight-release.mjs` runs
  **Then** it still reports NOT RELEASABLE with that gate's buffered output — the
  parallelization changes scheduling, never outcomes.

## Non-goals

- Dropping Node 20 *support*: `engines` stays `>=20`, so Node 20 users still install
  and run. The Node 20 **CI-matrix** job was removed as a follow-up (maintainer
  decision, 2026-07-06) — it duplicated the Node 22 coverage except for the sqlite3-CLI
  fallback path, which `test/parse/sqlite.test.ts` now covers directly. Bumping
  `engines` to `>=22` (a user-facing breaking change) remains a separate future call.
- Reducing determinism runs below 10, skipping tests, or weakening/removing any gate —
  the point is faster proof, not less proof.
- Caching across CI jobs (actions/cache for the goldens build): each job compiles once
  and reuse within the job already removes the waste; cross-job caching adds
  invalidation risk for ~3s of savings.
- New telemetry: no user-facing feature surface changes (SPEC-0043 events unaffected).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 node:sqlite preferred | Node ≥ 22.13, fixture DB | in-process reads; probe cached; CLI used only when node:sqlite absent |
| R2 warning suppressed | node:sqlite path active | no ExperimentalWarning on stderr; non-SQLite warnings pass through |
| R3 both paths byte-equal | full opencode receipt rendered via CLI reader and node:sqlite (`test/parse/sqlite.test.ts`) | byte-identical receipts; CLI real-data + `[]`-on-error hold |
| R4 cache hit | 2nd verify-goldens run, no edits | no tsc invocation; identical stdout; exit 0 |
| R4 cache invalidation | edit a src file / a price table | key changes; recompile; exit reflects verification result |
| R4 concurrent cold cache | two simultaneous runs | both exit 0; single valid (sentinel-complete) cache entry |
| R5 determinism gate | `determinism-check --runs=10 -- node scripts/verify-goldens.mjs` | 10 byte-identical outputs, seconds not ~36s |
| R6 preflight red path | failing gate injected | NOT RELEASABLE, gate's buffered output in fixed-order summary |
| R7 verification block | AGENTS.md commands, unmasked | all exit 0 verbatim, no gate removed or weakened |

## Success criteria

- [x] Local `npx vitest run` wall-clock materially reduced (target ≥ 2× vs the 58s
      baseline on the same machine).
- [x] CI `verify` job time materially reduced (determinism step ~36s → seconds).
- [x] Full preflight wall-clock ≈ its longest single gate, not the sum.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`).
- [x] `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass unmasked.
