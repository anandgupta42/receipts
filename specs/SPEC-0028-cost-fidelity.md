---
id: SPEC-0028
title: "Cost fidelity — floor totals, per-adapter reconciliation, plausibility tripwires, trust doc"
status: shipped
milestone: M4
depends: [SPEC-0023]
---

# SPEC-0028 · cost fidelity

Invariants: I1 (all checks deterministic from local inputs), I2 (a dollar we
cannot defend is a fabricated dollar — reconciliation failure demotes to
tokens-only, never silently keeps pricing), I3 (every new line is labeled and
traceable; floors say they are floors), I4 (harness is maintainer-run and
local; no telemetry change), I6 (tripwires report facts, never rank agents).

## Purpose

Maintainer directive (2026-07-03): *"we need to make sure the cost is getting
captured accurately or else people will lose confidence, or folks may use it
to game the receipt."* The motivating incident is live: PR #61's receipt
reads `TOTAL priced $3.29` while ~$180 of the authoring session sat honestly
noted as "not attributed" — the note is honest, but the **number** is what
gets quoted. Fidelity decomposes into four layers, and this spec hardens
each: totals that admit incompleteness (R1), token capture reconciled
against each agent's own accounting (R2), physics-level plausibility caveats
against edited or corrupt transcripts (R3), and a written threat model so
trust comes from stating limits, not hiding them (R4).

**Architecture directive (binding for the implementation):** all
per-assistant logic — parsing (already `SessionAdapter`,
`src/parse/types.ts:166`, registered in `src/parse/registry.ts:8`), cost
calculation hooks, and the new fidelity validators — integrates through the
registry: one module per agent, added as a file plus a registry row, never a
switch on agent type in shared code (AGENTS.md modularity law). The codebase
carries one live violation to retire as part of this spec:
`vendorForSource`'s switch (`src/pricing/resolve.ts:120-133`) moves onto the
adapter (a `vendor` field beside `id`/`label`, `src/parse/types.ts:167`).
Scope precisely: the adapter field replaces only the source-fallback path —
`vendorForTurn`'s model-prefix override (`src/pricing/resolve.ts:166`)
remains the primary resolution and is untouched. The fidelity surface is an
**optional** per-adapter interface — an agent without validators simply
contributes none and the harness reports it as "no validator" rather than
passing it silently.

**Kill criterion:** (a) if R2 reconciliation shows systematic, unexplained
drift for an adapter, the release board treats that adapter's priced rows as
blocked (the SPEC-0017 evidence-insufficient pattern) — the tokens-only
demotion then lands as its own reviewed change; the harness's job is to make
the drift undeniable, not to auto-demote; (b) if an R3
tripwire fires on any maintainer-labeled honest session, its threshold
widens or the tripwire ships dark — a caveat that cries wolf is worse than
none; (c) if the implementation PR leaves any shared-code branch on
agent type for fidelity/vendor logic, review blocks — the registry
directive is not advisory.

## Requirements

- **R1 — Floor-semantics totals.** In the PR comment body
  (`src/pr/body.ts:178` `totalBlocks`), when the receipt knows it is
  incomplete — `excludedCount > 0` or `unreadableCount > 0` — every total it
  renders becomes an explicit floor: `TOTAL priced ≥ $X` /
  `TOTAL unpriced ≥ T tokens`, and the existing notes stay. Complete
  receipts render exactly as today, byte-for-byte. The terminal receipt
  surface has no equivalent gap (a single session is never partially
  attributed), so goldens do not move.
- **R2 — Per-adapter reconciliation harness.** A maintainer-run gate,
  `node scripts/cost-reconcile.mjs`, mirroring
  `scripts/thrash-calibration.mjs` (compile-to-temp wrapper, explicit exit
  contract: 0 = all reconciled, 1 = drift or usage error, 2 = evidence
  insufficient). Validators are per-adapter registry modules behind one
  optional per-adapter surface on `SessionAdapter` (absent means no validator), each returning
  named findings:
  - **codex** — self-consistency: our summed per-turn `TokenUsage` must
    equal the rollout's **local** cumulative envelope: final
    `total_token_usage` minus any inherited baseline established by the first
    snapshot and its `last_token_usage`. Identical cumulative snapshots are
    replay records, not new billed turns, even when they retain a stale
    non-zero `last_token_usage`; after the first snapshot, a changed cumulative
    vector books its own component-wise difference rather than trusting a
    disagreeing `last` field. Any dropped/double-counted event still shows as
    drift. Tolerance 0 — same stream, so exact equality is the contract.
  - **claude-code** — usage-shape invariants provable from the normalized
    `Session`: per-turn `TokenUsage` components are non-negative, `total`
    equals the component sum (`src/parse/util.ts` `withTotal` discipline
    holds over real data), and turn timestamps are non-decreasing.
    Duplicate raw-record detection is out of scope until a validator reads
    raw files (Non-goals) — the normalized surface cannot prove it.
  - **cursor / opencode / gemini** — no validator initially: the harness
    lists them as `no validator registered`, visibly, so coverage gaps are
    a printed fact rather than an implied pass.
  The harness runs over local sessions bounded by `--limit` (newest-first,
  like `--init` in the thrash gate), prints per-adapter counts, and fails
  on any drift.
- **R3 — Time-integrity caveats.** Two deterministic checks computed at
  render time, surfaced as muted caveat lines and `--json` facts — never
  blocking, never a `$` change (I2/I3):
  - a turn timestamp later than the transcript file's `mtime` (plus a fixed
    2-minute write-slack constant) — content claiming to postdate its own
    file is the cheapest edit to catch;
  - a session whose span is non-positive while carrying usage.
  The `mtime` seam is explicit: the caveat module stats `filePath` at
  render time (the same disk state the render reads — deterministic for a
  given tree, I1; lazy discovery already uses `mtimeMs`,
  `src/parse/discovery.ts:113`). Each caveat names its evidence in one line
  (e.g. `caveat: turn 41 timestamp postdates transcript file`).
- **R4 — `docs/trust.md` threat model.** One page stating: what a receipt
  proves (records found on the author's machine, priced from cited, dated
  tables, deterministically re-renderable); what it cannot prove (that the
  author did not edit local JSONL — no local-first tool can); what makes
  fabrication visible (R3 caveats, R2 reconciliation, determinism); and
  that PR receipts are the author's disclosure, with unattributed work
  surfaced as R1 floors. Linked from README's receipt section and written
  to be quoted by a skeptic — no marketing sentences.

## Scenarios

- **Given** a PR receipt with one excluded candidate, **when** totals render,
  **then** the line reads `TOTAL priced ≥ $X` and the "not attributed" note
  still prints; **given** zero exclusions and zero unreadables, the body is
  byte-identical to today's.
- **Given** a codex rollout whose final cumulative envelope disagrees with
  our summed turns by one token, **when** the harness runs, **then** it
  exits 1 naming the session and the delta.
- **Given** adapters without validators, **when** the harness runs, **then**
  each prints `no validator registered` and the summary counts them
  separately from reconciled passes.
- **Given** a transcript whose turns claim timestamps after the file's own
  `mtime`, **when** the receipt renders, **then** a time-integrity caveat
  prints and the JSON carries the finding — and the `$` math is unchanged.
- **Given** an honest maintainer-labeled session set, **when** receipts
  render, **then** zero caveats fire (kill criterion b's evidence).

## Non-goals

- **Preventing local transcript edits.** Impossible without attestation
  infrastructure that would violate local-first (I4); R4 states this
  plainly instead of pretending otherwise.
- **Context-window ceiling tripwire.** Deferred until context windows exist
  as cited price-table data (SPEC-0005's schema owns that decision).
- **Output-rate plausibility ceiling.** Cut per S2: no defensible window/
  denominator/corpus definition yet, easy to dodge by editing timestamps,
  and it does not improve capture accuracy. Revisit only with a labeled
  corpus that defines the ceiling honestly.
- **Duplicate raw-record detection for Claude Code.** The normalized
  `Session` cannot prove it; requires a raw-reading validator — revisit
  when a real double-count is observed.
- **Cross-vendor billing reconciliation** (console invoices, OTEL). External
  systems, not local transcripts; out of scope for a deterministic gate.
- **CI enforcement of the harness.** Transcripts are local-only (I4); like
  the thrash gate, this is a maintainer/release-board check.
- **Changing SPEC-0026's draft comment layout.** R1 touches only the total
  lines; whichever of the two lands second rebases mechanically.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 floor priced | excludedCount = 1 | `TOTAL priced ≥ $X`; note retained |
| R1 floor unreadable | 1 unreadable subagent | `≥` on totals; unreadable note retained |
| R1 complete unchanged | no exclusions/unreadables | body byte-identical to pre-spec render |
| R1 mixed floors | priced + tokens-only atoms, 1 excluded | both subtotal lines carry `≥`, never blended (I2) |
| R2 codex exact | fixture rollout, envelope == sum | reconciled, exit 0 |
| R2 codex drift | envelope off by 1 token (fixture) | exit 1, session + delta named |
| R2 claude invariants | fixture with component/total mismatch | exit 1, invariant named |
| R2 no validator | cursor/opencode/gemini sessions present | `no validator registered` lines; separate count |
| R2 usage error | unknown flag / bad `--limit` | exit 1 before any session loads |
| R2 limit order | `--limit N` | newest-first bound, deterministic tiebreak |
| R2 counts | mixed-adapter corpus | per-adapter reconciled/no-validator counts printed |
| R2 insufficient | zero loadable sessions | exit 2, evidence-insufficient wording |
| R2 registry seam | adapter modules | each validator is its own file + registry row; no agent-type switch in shared code |
| R2 claude components | fixture with a negative component | exit 1, invariant named |
| R2 claude total | fixture where total != component sum | exit 1, invariant named |
| R3 mtime caveat | turn timestamp after file mtime (injected stat) | caveat line + JSON fact; `$` unchanged |
| R3 span caveat | non-positive span with usage | caveat line + JSON fact |
| R3 silent on honest | clean fixtures + labeled corpus | zero caveats |
| R3 unpriced safety | caveat on a tokens-only session | caveat renders; still no `$` (I2) |
| R4 doc parity | docs/trust.md claims | every capability claim maps to a shipped behavior (manual review row) |
| R4 linked | README receipt section | link to docs/trust.md present |
| vendor registry | `vendorForSource` callers | switch deleted; adapter `vendor` field serves all callers; results unchanged |
| determinism | same fixtures, 10 runs | identical receipts, caveats, and harness output (I1) |

## Success criteria

- [ ] PR #61-style incompleteness renders as a floor in this spec's own
      dogfood (re-run `aireceipts pr` on a branch with a known-unattributed
      session).
- [ ] `node scripts/cost-reconcile.mjs` passes over the maintainer's local
      sessions with zero drift, and its output (counts per adapter,
      including `no validator registered`) is pasted into the
      implementation PR.
- [ ] R3 thresholds justified against the maintainer corpus in the
      implementation PR (SPEC-0017's threshold-evidence pattern).
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, `node scripts/spec-lint.mjs` all
      pass unmasked (`echo $?`); terminal-receipt goldens untouched.

## Validation

**2026-07-03 · S1 (self):** every check is deterministic from local inputs
(transcripts, file stats, cited tables); floors/caveats add labels, never
dollars (I2/I3); the harness is maintainer-run (I4); the registry directive
is enforced by kill criterion (c) plus a matrix row, not by prose.

**2026-07-03 · S2 (Codex, read-only): REWORK → draft reworked.** Findings and
disposition:
1. `vendorForSource` range wrong (:120-133) and adapter `vendor` is only the
   source-fallback — `vendorForTurn`'s model-prefix override stays primary —
   **accepted**; scoped precisely.
2. Kill criterion (a)'s "reverts to tokens-only" had no mechanism —
   **accepted**; restated as a release-board block (SPEC-0017's
   evidence-insufficient pattern), demotion as its own reviewed change.
3. Rate caveat unmeasurable (no window/denominator/corpus) — **accepted**;
   see 9.
4. mtime seam uncited — **accepted**; R3 now stats `filePath` at render
   time with a fixed write-slack, citing the lazy-discovery precedent.
5. Claude duplicate-record claim unprovable from normalized `Session` —
   **accepted**; validator scoped to provable invariants, duplicates to
   Non-goals.
6. Missing matrix rows — **accepted**; usage-error, `--limit` order,
   per-adapter counts, split Claude invariants, span caveat, README link
   rows added.
7. `codex.ts` range under-cited — **accepted**; now :145-155.
8. R4 + R3 called scope creep — **rejected for R4** (the trust doc IS the
   maintainer's confidence ask verbatim), **accepted for R3's rate half**
   (see 9).
9. Cut the rate caveat — **accepted**; R3 is time-integrity only, the rate
   ceiling is a Non-goal with a labeled-corpus revisit condition.

**2026-07-03 · S3 (value gate):** the directive is verbatim from the
maintainer (2026-07-03), with the live PR #61 mispriced-total incident as
the motivating evidence for R1. Kill criterion (a)'s cheapest evidence is
built into the success criteria: the harness must run over the maintainer's
real sessions and its per-adapter output ship in the implementation PR.

**2026-07-03 · S4 (lint):** `node scripts/spec-lint.mjs` → 26 spec(s) OK,
exit 0.

**2026-07-03 · approved → building:** maintainer's in-session standing
instruction to proceed ("also start working on spec-28", "start clearing the
queue") — button 1 exercised; the final gate remains PR review.

**2026-07-03 · S5 (Codex implementation review): PASS.** Six audit
dimensions, all clean: (1) `totalBlocks`'s single floor predicate provably
covers every branch — a complete total can never render as a floor and an
incomplete one can never render bare; (2) the one changed expectation in
`test/pr/body.test.ts` is the specced behavior (unreadable subagent → floor),
not a weakened test; (3) no agent-type branch remains in shared fidelity/
vendor code — `vendorForSource` delegates to the registry, validators hang
off `SessionAdapter.fidelity`, `vendorForModel` stays primary as specced;
(4) caveats are text-only facts computed after pricing — no `$` path, no
golden movement (all committed fixtures silent); (5) the codex envelope
contract matches parser reality and the claude invariants are provable from
the normalized surface; (6) harness exit codes match the header contract,
including the wrapper mapping compile failures to 1. Live smoke: 5 real
codex sessions reconciled with zero drift.

**2026-07-03 · CI mutation-job failure → root cause fixed.** PR #65's first
`mutation` run failed in Stryker's DRY RUN: the telemetry first-run notice
leaked onto stderr in CLI tests (opposite symptom locally — notice missing
where expected). Root cause: `noticeStatePath` resolved home via
`os.homedir()` only — under Stryker's worker-thread pool a test's
worker-local `HOME`/`AIRECEIPTS_HOME` mutation is invisible to `homedir()`
(plain vitest forks write env through, hence green outside Stryker). It was
also a real product inconsistency: the notice was the one `.aireceipts`
file ignoring `AIRECEIPTS_HOME`, unlike budget and summary-cache. Fix: the
path now honors `homeOverride ?? AIRECEIPTS_HOME ?? homedir()` at call
time (src/telemetry/notice.ts). Not an assertion change — the failing
tests were right.

**2026-07-04 · shipped:** merged via #65; ledger sweep pre-release.

**2026-07-10 · live Codex reconciliation correction.** A content-free scan of
754 local rollouts found 535 repeated cumulative snapshots across 114 files,
five forked/subagent rollouts with inherited parent-inclusive baselines, and
five sessions that switched models mid-stream. The adapter now (1) ignores an
unchanged cumulative vector, (2) subtracts the first snapshot's inherited
baseline from the final envelope, (3) derives every later turn from cumulative
differences, and (4) stamps usage with the currently active `turn_context` model
instead of freezing the first model. Fixed regressions and
two fast-check properties cover arbitrary duplicate counts and inherited
baselines. `node scripts/cost-reconcile.mjs` then reconciled 40/40 recent Codex
sessions with zero drift (previous run: 30 reconciled, 10 failed).
