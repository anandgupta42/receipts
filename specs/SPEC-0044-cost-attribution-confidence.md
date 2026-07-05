---
id: SPEC-0044
title: "Cost-attribution confidence — the ConfidenceEvent contract + matrix"
status: draft
milestone: M4
depends: [SPEC-0028, SPEC-0038]
---

# SPEC-0044 · cost-attribution confidence

Invariants: I2 (never fabricate a `$`, never silently under-report), I3 (every
number traceable + its uncertainty stated), I5 (byte-golden). This spec
operationalizes the promise the product already prints — *"trust every character
on the receipt"* — for the flagship PR receipt, and makes that promise
mechanically enforceable rather than a matter of ongoing vigilance.

## Purpose

Maintainer directive (2026-07-05): the PR receipt is the product's core claim;
its cost must be *right, close to right, or visibly flagged when it isn't* — and
we must be **confident**, with a deep scenario matrix, e2e validation across all
agents, documented strategy, and guardrails so future changes can't regress it
silently.

Two grounded audits (`docs/internal/cost-attribution-evidence.md`) found the
honesty model is strong but has **specific silent-wrongness holes** and **no
systematic matrix**. The load-bearing finding (coverage-map C.2): an anchor-pool
session that touched a PR but can only fall back to "entire session" is dropped
with **zero trace** — the exact mirror of the #87 over-credit bug, and unlike
#87 it leaves no floor, no count, nothing. Both directions have already fired on
this repo (#87 over-credit; #79/#86 silent under-credit).

**The organizing principle:** for every `$`/token total the receipt shows,
exactly one of these is true and *provable by test*: (1) it reconciles to the
underlying tokens×cited-prices arithmetic, or (2) the receipt carries a
**visible signal** that it may be incomplete/uncertain. **Silent wrongness is
the one forbidden state.** The spec's spine is a single typed mechanism that
makes "no silent drop" a compile-and-test property, not a promise.

**Kill criterion:** (a) the new incompleteness signals must NOT fire on the
repo's own already-correct merged PRs — a dogfood measurement: run `--self-check`
over the last 20 merged PRs of this repo; if any *correct* receipt gains a
spurious incompleteness flag, that signal's threshold is wrong and is retuned
before ship (a concrete bound, not "vibes"). (b) A matrix cell the agent
genuinely cannot produce is `n/a` with a validated one-line reason — an honest
empty cell, never a fabricated fixture.

## Requirements

- **R1 — The ConfidenceEvent contract (the spine; everything else hangs here).**
  Introduce a typed union `ConfidenceEvent` (a zod schema / discriminated union,
  cited not inlined) enumerating every reason a contributor's cost can be
  dropped, degraded, or lower-bounded — e.g. `unattributable-anchor-pool`,
  `unreadable-subagent`, `unpriced-model`, `cost-lower-bound-cache-tier`,
  `silenced-git-write`. **All** drop/degrade/lower-bound decisions in
  `src/pr/{contributors,rollup,promote}.ts` and the pricing path must route
  through a single decision surface that RETURNS one of these events (never a
  bare `continue`). Enforcement is two-pronged and real: (i) an **exhaustive**
  test/`switch` over the union — a new variant fails to compile until it has a
  rendered signal; (ii) a **hygiene check** (`scripts/hygiene.mjs`) that greps
  those files for contributor-dropping control flow (`continue`/`.filter(`) not
  accompanied by a `ConfidenceEvent` emission, failing CI on a silent drop. This
  is what makes R1 a property, not theater (S2 finding 1).
- **R2 — Prove the contract by closing the two priority holes as emitters:**
  - **A1 (the C.2 hole, priority):** the anchor-pool `full`-fallback skip
    (`contributors.ts` `anchor && full → continue`) emits an
    `unattributable-anchor-pool` event → `body.ts` renders a **distinct**
    counted-absence note ("N session(s) touched this branch but couldn't be
    attributed precisely — [trust.md]") and floors the total `≥`. It is NOT
    merged into `excludedCount`'s reason. Requires wiring the event through
    `ContributorSelection`/`Resolved`/`runPr` into `PrBodyInput` (S2 finding 4);
    the tests that currently assert the *silent* behavior
    (`contributors.test.ts:167`, `attribution-fidelity.test.ts:99`) are inverted
    (red-then-green).
  - **A3:** the cache-tier fallback (`resolve.ts` `cacheWriteCost`) emits a
    `cost-lower-bound-cache-tier` event carried alongside the priced figure (the
    number-only return is widened to `{usd, events}` — S2 finding 3) → the
    receipt shows a muted "cache-write cost is a lower bound for this session"
    caveat. This proves the contract spans the pricing path too, not just
    selection.
- **R3 — The scenario × agent matrix, judged against an independent oracle.** A
  declarative matrix (`test/matrix/cost-matrix.ts`): rows = taxonomy scenarios
  (subagents, delegation, parallel calls, loops, compaction/thrash, fork/resume,
  multi-model, cache tiers, reasoning tokens, interrupted turns, PR
  multi-session incl. quiet-commit/message-anchor/nested/cross-repo); columns =
  the priced agents (Claude Code, Codex, opencode; Cursor where structurally
  possible). Each populated cell has (a) a **fixture** in that agent's exact
  on-disk format, (b) a **hand-authored `expected` manifest** — the total and
  the set of flags, authored independently of the parser, NOT read back from the
  code under test (S2 finding 6) — and (c) an **e2e assertion through the real
  CLI** that the rendered receipt matches the manifest (total reconciles OR the
  declared flags fire). `n/a` cells carry a validated non-empty reason.
- **R4 — The completeness guardrail (the durable regression guard).**
  `test/matrix/completeness.test.ts` fails CI if any (scenario, agent) cell is
  neither backed by a fixture+manifest+assertion nor explicitly `n/a` with a
  reason. Adding a scenario row or an agent column without covering the new
  cells fails the build — this is what keeps confidence from decaying after the
  one-time audit.
- **R5 — Reconciliation property over the matrix oracle.** Extend the fast-check
  ledger property (`test/pr/ledger.test.ts`) and add a matrix-driven check: for
  every priced cell, the CLI-rendered `TOTAL` equals its manifest total (float
  epsilon) and equals `Σ` per-contributor = `Σ` per-tool; the declared flags are
  exactly those rendered. The red path — mutate a fixture to drop a turn/session
  without updating the manifest — must fail (proving the test compares against
  an independent oracle, not itself — S2 finding 5).
- **R6 — `docs/cost-model.md` (living).** The per-scenario, per-agent cost
  strategy: what's extracted, how it's priced, the fallback, and exactly when
  each `ConfidenceEvent` fires. A test pins that every `ConfidenceEvent` variant
  from R1 is documented here and in `trust.md`'s "Where the numbers can go
  wrong" (which gains the A1/A3 entries, and an A2 known-gap pointer).
- **R7 — Maintainer real-session self-check (dogfood assurance, not a CI
  invariant).** `aireceipts pr --self-check` run against the maintainer's OWN
  real sessions reports, per session: did the receipt's arithmetic reconcile,
  and which `ConfidenceEvent`s fired — a content-free summary table. This exists
  because no automated test may read real transcripts (harness rule) and the
  maintainer explicitly wants real-world confidence across all four agents. It
  is a tool + a success-criterion (maintainer runs it and pastes the summary),
  explicitly not a mechanical product invariant (S2 finding 7).

## Scenarios

- **Given** an anchor-pool session that touched the branch but only
  full-falls-back, **then** the total floors `≥` and a distinct counted-absence
  note names how many such sessions exist (A1) — never silent.
- **Given** the cache-tier fallback prices an unsplit write, **then** a muted
  "lower bound" caveat renders (A3).
- **Given** any populated matrix cell, **then** the CLI output matches the cell's
  independent `expected` manifest (total reconciles or declared flags fire).
- **Given** a fixture mutated to drop a turn without updating its manifest,
  **then** R5 fails.
- **Given** a new scenario row or agent column with no fixtures, **then** R4
  fails CI.
- **Given** a new `ConfidenceEvent` variant with no rendered signal, **then** R1
  fails to compile / the hygiene check fails.

## Non-goals

- **A2 — fully attributing Cursor Background Agents** (`agentKv:`/`glass.` keys)
  is a **separate spec**: honest PR-scoping needs their timestamps + cwd, which
  requires reading the background-agent schema (S2 finding 2). This spec records
  A2 as a known gap in `cost-model.md`/`trust.md` (so it is not mistaken for
  covered) and does not emit a noisy un-scoped "some Cursor BA exists somewhere"
  note that can't be tied to the branch.
- **B3 opencode upstream corruption**, **B4 distinct reasoning-token price** —
  documented in the matrix as external / assumption-to-revisit, not fixed here.
- **Reading real user transcripts in any automated test** — R7 is maintainer-run
  and content-free.
- **Re-litigating already-correct+flagged behavior** — those get matrix cells,
  not new mechanisms.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 union exhaustiveness | add a `ConfidenceEvent` variant with no signal | compile/test fails |
| R1 hygiene | a contributor-drop `continue` with no event emission | hygiene check fails |
| R2/A1 counted-absence | anchor-pool full-fallback session touching branch | `≥` floor + distinct counted-absence note; not merged into excludedCount; red-then-green vs the old silent tests |
| R2/A3 cache-tier caveat | Claude Code session, unsplit cache-write | muted "lower bound" caveat present |
| R3 matrix vs oracle | each priced cell fixture through CLI | rendered receipt matches the hand-authored `expected` manifest |
| R3 n/a honesty | a cell the agent can't produce | `n/a` + validated non-empty reason; no fixture |
| R4 completeness | remove a fixture / add uncovered agent column | completeness test fails |
| R5 red path | mutate a fixture, leave manifest stale | reconciliation fails |
| R6 doc sync | each `ConfidenceEvent` variant | present in docs/cost-model.md + trust.md (test-pinned) |
| R7 self-check | run on a fixture home | reconcile + events-fired summary; zero content leaked |
| C1 codex reasoning fold | codex fixture w/ `reasoning_output_tokens` | lands in output total (regression guard) |
| C3 grandchild subagent | 2-level-nested fixture | priced or counted-absent — never silently missing |

## Success criteria

- [ ] The `ConfidenceEvent` union exists; every contributor drop/degrade/
      lower-bound routes through it; the exhaustiveness test + hygiene check are
      green and demonstrably red when bypassed.
- [ ] A1 and A3 are closed as emitters, shown red-then-green.
- [ ] The matrix renders green across populated cells against independent
      manifests; `n/a` cells carry reasons; the completeness guard fails when a
      cell is uncovered (shown in the PR).
- [ ] Kill-criterion (a) met: `--self-check` over this repo's last 20 merged PRs
      raised no spurious incompleteness flag on a correct receipt.
- [ ] `--self-check` run on the maintainer's real sessions; summary pasted in
      the PR.
- [ ] `docs/cost-model.md` published; `trust.md` updated.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` pass unmasked.

## Validation

**2026-07-05 · S1 (self):** the spec's spine is now a single typed mechanism
(`ConfidenceEvent`) whose totality is compile- and hygiene-enforced, not
promised; the matrix judges against hand-authored oracles, not the code under
test. Both were the difference between an enforceable spec and theater.

**2026-07-05 · S2 (Codex, read-only): REWORK → reworked.** 8 findings, all
accepted:
1. HIGH — R1 totality aspirational → recast as the typed `ConfidenceEvent`
   union + single decision surface + exhaustiveness test + hygiene grep.
2. HIGH — A2 counted-absence needs BA timestamps/cwd → **deferred to its own
   spec**; recorded as a known gap, no un-scoped noisy note.
3. HIGH — A3 not local; runtime carries no caveat metadata → `cacheWriteCost`
   return widened to `{usd, events}`, event propagated to the receipt.
4. MED — A1 wiring understated → spec now names the `ContributorSelection`/
   `Resolved`/`runPr`/`PrBodyInput` path and the test inversion.
5. MED — R5 overclaimed the ledger seam → reframed to compare CLI output
   against each fixture's independent `expected` manifest; red path defined.
6. MED — R3/R4 real only with independent expected facts → manifests are
   hand-authored, not read back from the parser; `n/a` reasons validated.
7. LOW — kill criterion + R7 not mechanical → kill criterion given a concrete
   dogfood bound (no spurious flag on the repo's last 20 correct PRs); R7
   reframed as a maintainer tool + success-criterion, not a CI invariant.
8. Scope → A2 split out; A1 + ConfidenceEvent + matrix + guard kept together as
   the coherent core; R7 kept (explicit maintainer demand) but reframed.

**2026-07-05 · S3 (value gate):** the kill criterion's evidence is the repo's own
history — the exact silent-under-credit this closes (C.2) is the mirror of a bug
(#87) the maintainer caught by eye; the dogfood bound (no spurious flags on 20
correct PRs) is runnable the day A1 lands.

**2026-07-05 · S4 (lint):** `node scripts/spec-lint.mjs` → OK.

Status remains draft pending maintainer approval (button 1).
