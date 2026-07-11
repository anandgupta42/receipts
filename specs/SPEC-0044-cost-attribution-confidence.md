---
id: SPEC-0044
title: "Cost-attribution confidence — the ConfidenceEvent contract + matrix"
status: building
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
- **R8 — B1: displayed rows must sum to the displayed TOTAL (this PR).** A
  fourth adversarial re-evaluation (`docs/internal/cost-attribution-review-findings.md`)
  found a **visible** self-contradiction the earlier reviews missed: priced
  rows are `formatUsd`'d independently while the TOTAL sums the RAW `usd` and
  rounds separately — no shared rounding basis, so a receipt can show rows
  that don't add up to its own total (e.g. 3 rows @ $0.004 → rows show
  $0.00×3, Σ $0.00, but TOTAL $0.01). Fix: `reconcileCents`
  (`src/receipt/format.ts`) — largest-remainder / Hamilton's method — keeps
  TOTAL as today's correctly-rounded raw sum and apportions its cents across
  rows (floor each row, hand leftover cents to the largest fractional
  remainders) so displayed rows sum EXACTLY to the displayed total. Applies
  wherever priced rows sit beside their total: single-session receipt tool
  rows (`present.ts`) and PR-body contributor/subagent rows (`body.ts`).
  Display-only — `--json` and all underlying `usd`/`totalUsd` values are
  unchanged. Enforced by an invariant, not a snapshot: `test/pr/ledger.test.ts`
  Tier 2 tightened from a tolerated per-row drift bound to exact equality
  (Σ displayed row cents == displayed TOTAL cents), plus
  `test/receipt/reconcile.test.ts` unit-testing `reconcileCents` (proof cases,
  negatives, zero, single-row, empty, ties) and end-to-end across every
  template.
- **R9 — B3: per-record parse-skip must emit a `ConfidenceEvent` (pending).**
  `readJsonl` (`util.ts`) silently `continue`s on a malformed line with no
  event and no skip-count surfaced to callers; a crash-truncated line in a
  *credited* session drops that turn's cost with nothing to show for it.
  Deferred — not part of this PR.
- **R10 — B4: whole-candidate load failure must emit a `ConfidenceEvent`
  (pending).** `contributors.ts` drops an unloadable anchor-pool/sibling-repo
  candidate with no event; `promote.ts` drops any unloadable sidechain
  unconditionally. R1/A1 only covers *loaded-but-full-fallback*, not
  *failed-to-load* — "couldn't read" is a distinct forbidden state from "no
  anchor". Deferred — not part of this PR.
- **R11 — B5: grandchild subagent double-count (pending).** If P→A→B and A
  independently commits (becoming a top-level contributor excluded from P's
  rollup), B is not itself a contributor so isn't excluded — P's recursive
  child discovery finds B *and* A's own rollup finds B, counting B twice.
  Needs subtree-aware rollup dedup. Deferred — not part of this PR.
- **R12 — M1/M2: broaden the silent-drop hygiene check; resolve dead
  `ConfidenceEvent` variants (pending).** The hygiene check
  (`scripts/hygiene.mjs`) only regex-bans `excludedCount` mutation in three
  files, not the real shapes a silent drop takes (bare `continue`,
  `return []`, helper-file drops, pricing-path drops) — this is why B1–B4
  slipped past the R1 contract's own enforcement claim. Separately,
  `unreadable-subagent` and `cost-lower-bound-cache-tier` are declared
  `ConfidenceEvent` variants that are never actually minted; either wire real
  emitters or delete them and document the legacy path honestly. Deferred —
  not part of this PR.

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
- **Given** priced rows whose individually-rounded cents don't sum to the raw
  total's own rounding, **then** the displayed rows are cent-reconciled so
  their sum equals the displayed TOTAL exactly (R8/B1) — never merely close.

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
| R8/B1 row reconciliation | 3 rows @ $0.004 (naive Σ $0.00 vs TOTAL $0.01); 2 rows @ $0.006 (naive Σ $0.02 vs TOTAL $0.01) | displayed rows sum exactly to displayed TOTAL, both templates and render paths (single-session + PR body) |
| R9/B3 parse-skip *(deferred)* | a credited JSONL session with one malformed/truncated line | a ConfidenceEvent fires + the total floors `≥`; not a silent drop |
| R10/B4 load-failure *(deferred)* | an anchor-pool / sibling-worktree / sidechain candidate that fails to load | a ConfidenceEvent fires; not silently skipped |
| R11/B5 grandchild dedup *(deferred)* | P→A→B where A independently commits | B counted once (subtree-aware rollup dedup), not under both P and A |
| R12/M1+M2 *(deferred)* | a bare contributor-drop `continue`; a never-emitted ConfidenceEvent variant | hygiene check fails on the drop; every declared variant is emitted or deleted |

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

**2026-07-05 · approved (button 1):** maintainer, in-session ("approved"). Status → building.

**2026-07-05 · S5 (implementation review, Codex): REWORK → all 5 fixed.**
1. HIGH — A1 not end-to-end when it's the only signal (`runPr` aborted with
   NO_MATCH before rendering) → the zero-contributor path now emits an
   informative counted-absence message naming the unattributable sessions.
2. HIGH — `promote.ts` had the SAME A1 hole (bare `continue` on full-fallback)
   → promote now returns `{promoted, events}`, emits `unattributable-anchor-pool`,
   merged into the body's confidence summary; a dedicated promote A1 test added.
3. MED — distinct counting used `summary.id` (collides for nested candidates)
   → events now carry `summary.filePath` (file-unique).
4. MED — hygiene ban was `excludedCount++`-only (bypassable by `+= 1`) →
   regex widened to `++/--/+=/-=/self-reassign`; proven to catch the `+=`
   variant; honestly scoped as a backstop (the exhaustive switch + behavioral
   tests are the primary proof).
5. MED — body floored only on `excludedCount` → now floors on
   `isFloored(summary)`, covering every ConfidenceEvent kind.
Plus: `confidence.ts` converted from a zod schema to a plain TS discriminated
union — these events are minted internally (never parsed from external input),
and the top-level `z.discriminatedUnion` broke the goldens' temp-compile-run
zod resolution; the compiler-exhaustiveness guarantee is unchanged.

**Scope shipped in this PR:** R1 (the enforceable contract) + R2/A1 (the
priority hole, in BOTH contributors.ts and promote.ts) + R6 docs. A3
(cache-tier caveat — variant declared, emitter deferred), the matrix (R3-R5),
and `--self-check` (R7) are the remaining build under this `building` spec.

**2026-07-05 · four-review re-evaluation (Codex + money-math re-derivation +
honesty forbidden-state red-team + test-quality/mutation audit):** with R1/A1
merged, the team re-attacked the whole money path rather than assume it was
now settled. The reviews found six further real bugs the earlier research,
spec, and first build all missed
(`docs/internal/cost-attribution-review-findings.md`), one of them — B1 —
**visible with no failure required**: displayed per-row amounts don't sum to
the displayed TOTAL, because rows and the total round independently with no
shared basis. Ranked by the reviews as highest priority precisely because it's
visible (a skeptic adds the column and it doesn't match), B1 is recorded here
as **R8** and lands in this PR. B3/B4/B5/M1/M2 are recorded as **R9-R12**,
deferred to their own builds per the fix program's ordering (B1 first).
Verified-not-bugs from this pass: A1 cannot double-count across
`contributors.ts`/`promote.ts` (sorted XOR at `index.ts:165`);
`bodyInput.confidence` is always populated at the real CLI call site, so the
"confidence omitted" path is type-only and unreachable; `summarizeConfidence`
exhaustiveness forces a case but not necessarily a rendered signal (a
follow-on note for R12, not a new bug).

**2026-07-05 · R8/B1 implementation:** `reconcileCents`/`formatCentsAmount`
added to `src/receipt/format.ts` (largest-remainder apportionment; TOTAL's own
rounding is untouched, only row splits are computed); wired into
`present.ts` (`reconciledRowText`, keyed by `ToolRow` object reference so
`buildDatavis`'s filtered row subsets still align) and `body.ts`
(`reconciledAtomText`, keyed by `ContributorView | SubagentRow` reference).
`test/pr/ledger.test.ts`'s Tier 2 assertion tightened from a tolerated
per-row drift bound to exact equality; `test/receipt/reconcile.test.ts` added
covering `reconcileCents` directly (proof cases, negatives, zero, single-row,
empty, all-tied remainders, a 300-run fast-check property) plus end-to-end
render-path assertions for both proof cases across all three templates and
both the single-session and PR-body paths. A genuine but separate
completeness gap was found in the process and flagged out of scope: nothing
in `src/pr/contributors.ts`/`body.ts` structurally guarantees a `helper`-basis
contributor has empty `subagents` — `helperGroupBlocks` renders exactly one
row per helper with no loop over `h.subagents`, while `collectAtoms`/
`totalsFor` sum ALL contributors' subagents unconditionally into the priced
total. If a helper ever has priced subagents, those dollars count toward
TOTAL but are never rendered as any row — a visibility/completeness gap,
different in kind from B1's rounding-drift bug.

**2026-07-05 · R8/B1 takeover review (Codex, 3 rounds): REWORK×2 → PASS.** The
lead finalized the build (the builder stalled pre-push) and ran the deferred
Codex review, which turned the "future work" note above into a fix:
1. HIGH — helper subagents counted in TOTAL but never drawn (the gap above) →
   `helperGroupBlocks` now renders each helper's subagents as their own rows,
   matching how `contributorBlocks` draws author subagents. Counted == drawn.
2. HIGH — a first attempt *folded* helper subagents into one helper atom; the
   ledger property test (helper-subagent generation un-masked) found the fold
   hid a tokens-only helper's genuinely-unpriced tokens (`usd:null` helper +
   priced child → the 1000 unpriced tokens vanished from `TOTAL unpriced`).
   Rejected the fold; kept per-subagent accounting + rendering instead.
3. LOW — stale test comment corrected. Goldens byte-identical (fixtures carry
   no helper subagents). Final Codex verdict: PASS, no HIGH/MED. The invariant
   now holds for BOTH the priced-`$` and unpriced-token subtotals.

**2026-07-05 · R9/R10 (B3 + B4) build — silent-drop holes closed.** Two new
ConfidenceEvent variants: `unreadable-session` (B4 — an in-window candidate
that failed to LOAD, outside the current worktree, emitted in
`contributors.ts`/`promote.ts`; "couldn't read" ≠ "read, no anchor") and
`dropped-transcript-records` (B3 — `readJsonl` now returns its skipped-line
count, threaded to `session.droppedRecords` across all four adapters incl.
opencode's per-row loop; a credited session or rolled-up subagent with drops
emits the event in the `index.ts` cost loop + a single-session receipt caveat).
Both floor `≥` and render a note; `droppedRecords` is omitted-when-0 (clean
sessions' shape unchanged — the discovery-cache deep-equal). Red-then-green: the
`contributors.ts`/`promote.ts` "silently ignores/skips" tests inverted to assert
the new counts; a `dropped-record-midstream` fixture (one truncated line, three
valid) proves the count + caveat + a still-priced total; a negative control (a
clean transcript) trips nothing.

**2026-07-05 · S5 (Codex, B3/B4): REWORK → 3 fixed, 1 deferred.**
1. HIGH — rolled-up subagents with drops were silent → B3 emission moved to the
   `index.ts` cost loop and now also scans `view.subagents` (added
   `droppedRecords` to `SubagentRow`); covers subagent drops.
2. HIGH — `pr --session` returned `events:[]`, bypassing B3 → fixed for free by
   moving emission to the cost loop, which `--session` contributors flow
   through (verified).
3. MEDIUM — `dropped-transcript-records` missing from the `--json` export enum →
   added; a test asserts a B3 receipt stays schema-valid.
4. HIGH (DEFERRED, honest) — a session that fails FULL-LOAD during
   `listFullSessions()` discovery is filtered before selection, so B4 (which
   covers selection-time `loadSession` failures) never sees it. This is a
   distinct, deeper discovery-layer gap the B4 finding didn't scope (a session
   that passes lazy first-line discovery but fails full parse — rarer than the
   partial-corruption B3 now handles). Recorded as follow-up work, not silently
   dropped from the record. Final Codex verdict after fixes: the three in-scope
   findings resolved; 506 pr/receipt/parse/matrix tests green, hygiene + spec-
   lint OK, goldens byte-identical (caveats fire only on drop/load-failure).

**2026-07-05 · R11/B5 (grandchild double-count):** `index.ts` now computes a
per-contributor subtree-aware exclusion set (`isDescendantOfContributor` +
`exclusionsFor`) so a promoted middle contributor A owns its whole subtree —
grandchild B is rolled up once under A, not also under P. Kept as the single
dedup site; `rollupChildren`'s exact-file check unchanged. Codex: PASS (1 LOW —
a comment overclaimed the recursion depth vs what `nestedCandidates` admits;
softened). Goldens byte-identical (no existing fixture has the P→A→B-with-
middle-commit shape). Red-then-green via `test/pr/grandchild-dedup.test.ts`.

**2026-07-05 · R12/M1-M3 (guardrails capstone):**
- **M3 (the systemic fix):** `stryker.config.json` `mutate` extended to
  `src/pr/**/*.ts` (was `src/pricing/**` only) and `mutation.yml` now triggers on
  `src/pr/**` changes — the PR-attribution money path is mutation-gated in CI for
  the first time. Baseline src/pr/** score measured at 66% (clears the break
  threshold with margin). Added tests: the exported `pushSessionSubagentEvents`
  emitter (6 cases) and an exact full-fallback slice-boundary test (kills the
  `Math.max(0, turnCount-1)` mutants the `.kind`-only fallback tests missed). The
  `isFloored` per-disjunct mutants the review named were already killed by B3/B4's
  isolated tests. Remaining named survivors (`contributors.ts:142` shaIncluded gate,
  `slice.ts` firstOwn/foreign-window boundary) need intricate anchor-ordering
  fixtures — deferred honestly; the gate now RUNS and reports them so they can't
  regress unseen.
- **M2:** `unreadable-subagent` was the last dead ConfidenceEvent variant — now
  emitted via the cost-loop `pushSessionSubagentEvents` (exported + unit-tested),
  so it agrees with the legacy `totals.unreadableCount` floor by construction. No
  note change → goldens byte-identical. The "single typed enumeration" claim now
  holds for every variant.
- **M1:** `checkNoSilentDrop` broadened with a narrow, low-noise check — a
  load-failure guard on the loaded `session` var (the B4 shape) that drops a
  candidate with no ConfidenceEvent / unreadable-row / excludeHere fails CI. Proven
  to bite (gutting promote.ts's emit flags it) and to pass clean (no false positive
  on the `l.session` eligibility skip or the rollup unreadable-row path). The
  contract doc (`confidence.ts`) rewritten to describe enforcement HONESTLY: the
  exhaustive switch + the mutation gate are the real guards; hygiene is a narrow
  regex backstop, not the general silent-drop proof it previously claimed to be.

**2026-07-05 · R12 + M3 guardrails capstone (Codex: REWORK → addressed):**
M3 extends the Stryker `mutate` glob AND `mutation.yml` trigger to `src/pr/**`
— the flagship attribution path that had ZERO mutation enforcement (the
test-quality review's systemic finding). M2 emits `unreadable-subagent`
through the contract (agreeing with the legacy `SubagentRow.unreadable` floor,
no double-note). M1 adds a targeted hygiene backstop for the B4 load-failure
drop shape. Codex findings: (1) break=60 flagged as permissive → kept as the
honest FLOOR (same as pricing; a real guard on a path that had none) with the
score-not-decreased ratchet documented as a follow-up; (2) two named survivors
not killed → `writeCount++`→`--` now killed by an exact-count test; the
`shaIncluded` mutants are partly EQUIVALENT (a `writeCount===0` codex session
structurally has no commit subjects, so the `!==0` mutant can't change the
outcome) and partly covered by existing basis-label assertions — the remaining
subtle ones are a mutation follow-up, not a correctness gap (the gate now
catches gross regressions). Goldens byte-identical; the CI mutation run
verifies the combined score clears the floor.

**2026-07-10 · matrix and partial-coverage correction.** The three hero cells
now pin independently calculated exact USD—not merely `priced: true`—and the
built artifact stages native Claude Code JSONL, Codex JSONL, and opencode SQLite
homes through discovery → parse → price → JSON. A separate PR aggregation audit
found that a mixed-price contributor/subagent collapsed into one `$` atom, so
its unpriced turns vanished from `TOTAL unpriced`. `AttributionResult` now
carries exact `unpricedTokens` through `ReceiptModel`, contributor and subagent
views; `partial-priced-coverage` joins the typed event contract, floors the
known-dollar total, and renders the exact unpriced-token subtotal plus a counted
note. Fully priced output and all 102 goldens remain byte-identical.

**2026-07-10 · adversarial pricing-domain follow-up.** `priceTurn` now refuses
non-finite, negative, fractional, component-total-mismatched, or out-of-subset
cache-tier usage rather than allowing negative/NaN/fabricated dollars. The same
validator guards the two direct `costOf` side paths (trivial spans and price
delta), and partial-price sessions no longer compute a whole-session price delta
from tokens their actual dollar excluded. Fast-check proves arbitrary valid
integer/cache-tier combinations still equal `costOf` exactly and arbitrary
invalid domains stay unpriced.

**2026-07-10 · provider-identity safe stop.** Explicit provider evidence is now
part of every turn's pricing decision. Codex `model_provider` and opencode
`providerID` select a recognized direct table or block routed/custom traffic to
tokens-only; only absent evidence retains legacy inference. Focused regressions
cover nested/string/session metadata, direct and blocked providers, provider
switches, and every pricing consumer so a routed turn cannot regain a dollar in
waste, attribution, price-delta, or receipt-model side paths.

**2026-07-10 · R13 visible cost-basis amendment.** Internal token×dated-row
arithmetic remains deterministic, but a local transcript is not a
billing ledger: auth/billing channel, negotiated plan, regional uplift, actual
service tier, upstream credits, or an unpersisted usage dimension may differ.
Every human-readable dollar total and component therefore carries `≥` as a
**standard API list-price-equivalent observable floor**. Machine exports retain
their numeric compatibility fields and gain an additive structured lower-bound
cost marker. Counterfactual/savings lines stay explicitly approximate. For
GPT-5.6 Codex, per-response context tier comes from changed cumulative usage;
absent `cache_write_tokens` contributes zero to the floor. Built-artifact E2E
fixtures for Claude Code, Codex, and opencode must assert both the independently
calculated numeric arithmetic and its visible/machine-readable qualifier.

**2026-07-10 · R14 strict-floor correction (supersedes B1/R8 display
reconciliation).** A largest-remainder cent split can assign one cent to a row
whose raw value is only 0.6 cents, making `≥ $0.01` false. Every human lower
bound now rounds **down** independently (fractional-cent values retain four decimals),
and no row borrows a cent from another. Machine scalars retain the unrounded
arithmetic. Cached reads/writes with no cited applicable rate contribute zero,
not a guessed input-rate fallback, with a visible cache-rate caveat. The public
export meaning changed from exact-looking cost to lower bound, so
`SCHEMA_VERSION` is 2. Rows need not sum byte-for-byte after independent display
flooring; each row and total must instead be individually no greater than its
raw scalar.

**2026-07-10 · request/identity fail-closed amendment.** The product path now
turns Codex reconciliation from a maintainer-only signal into a pricing gate.
Non-monotone cumulative usage, a missing/zero/disagreeing post-baseline
`last_token_usage`, mixed legacy+cumulative schemas, dropped records, or a
request sum that misses the final local envelope disables all request dollars
and preserves one unattributed token envelope with a caveat. Claude id-less
assistant usage is also one coherent unattributed envelope, not a set of priced
requests. Every pricing consumer uses each unit's own model/provider/timestamp;
trivial-span dollars require all units to pass that gate.

For PR child rollups, `full`, `range`, and `unknown` are distinct evidence
states. Range inclusion uses true interval intersection. An unknown sliced
parent excludes all readable child cost, while unreadable child evidence stays
counted. OpenCode crossed aggregate/itemized vectors remain itemized and expose
only positive aggregate-only conflict, excluded from totals and dollars.
