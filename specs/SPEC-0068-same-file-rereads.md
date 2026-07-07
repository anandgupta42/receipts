---
id: SPEC-0068
title: "Same-file re-reads — a neutral diagnostic fact, kept out of the waste/savings math"
status: approved
milestone: M5
depends: [SPEC-0001, SPEC-0017]
---

# SPEC-0068: Same-file re-reads

Invariants: I1 (deterministic, transcript-only), I2 (`usd: null` for any unpriced run — no guessed
dollar), I5 (goldens gate the bytes), I6 (a fact about observed repeated reads, never a judgment
that they were wasteful). The transcript cannot prove a re-read was unnecessary, so this reports
reads with **no recorded** cause — never "wasted" and never a savings figure.

## Purpose

Re-reading the same file is the largest agent-cost pattern in the literature (arXiv *SWE-Pruner*:
reads = 76% of tokens; a cross-tool analysis: ~42% of tokens on repeated reads) and in this repo's
own data (measured 2026-07-06: 41% re-read rate over 38 substantial Claude Code sessions; **23% of
re-reads** had no recorded edit, compaction, or shell touch between — across 25/38 sessions). The
byte-identical `duplicate-reads` attempt was cut (0 in the wild + unobservable "waste"). This spec
lands the correctly-scoped signal — **same-file** re-reads (any range) with no recorded cause — as
a **neutral diagnostic fact with token cost**, explicitly **outside** the `WasteLine`/"could have
saved" machinery (S2: waste lines feed `COULD HAVE SAVED` in handoff and PR body, which would
contradict the caveat). **Kill criterion:** on the labeled ≥20-session corpus the no-recorded-cause
set must (a) be non-trivial and (b) survive a maintainer spot-check as not dominated by causes the
exclusions miss (whole-tree shell ops, external edits, user-requested re-reads); if not, it ships
tokens-only or stays draft.

## Requirements

- **R1 — Same file = same normalized path (any range).** A read is a `ToolCall`
  (`src/parse/types.ts:58`) whose `name` is `Read` (Claude Code, `src/parse/claudeCode.ts:271`)
  with a non-empty string `file_path`. Two reads are the same file when their normalized
  `file_path` matches (resolve `.`/`..`, collapse separators; absolute vs relative and
  basename-only are **not** treated as equal — S2: `src/a.ts` ≠ `test/a.ts`), **regardless of
  `offset`/`limit`**. A read whose `status` is an error is not a "first read" (a failed read then a
  successful read is a legitimate retry, not a re-read — S2). Non-Claude adapters emit no `Read` and
  never fire (I6, stated).
- **R2 — Re-read counting with recorded-cause exclusions, over a global call ordinal.** Implement
  inside `src/pricing/waste.ts`, extending the private `FlatCall` (`src/pricing/waste.ts:42`) with
  raw `name`, `input`, `shell`, and its global flattened-array index as the ordinal (do not export
  privates — S2). A compaction is modeled as a synthetic ordinal immediately before the first call
  of its `turnIndex` (`Compaction.turnIndex` is next-turn granular — S2). The 2nd..Nth reads of a
  path are candidate re-reads; a candidate is **excluded** when between it and the prior read of
  that path there was, by ordinal: **(a)** an edit tool (`Edit`/`Write`/`NotebookEdit`) to that
  path; **(b)** a compaction; or **(c)** a `shell` call whose `command` either mentions the file's
  basename **or** is a whole-tree mutator (`git checkout`/`reset`/`apply`/`stash`, `prettier
  --write`, `find … -exec`, etc. — a named, extensible list). Survivors are the **no-recorded-cause**
  re-reads.
- **R3 — Cost attribution.** Each no-recorded-cause re-read contributes its per-call token share
  (the `flattenCalls` even-split convention, `src/pricing/waste.ts:52` — an attribution convention,
  not measured tool-output cost, stated in R4) to `tokens`; `usd` is the summed priced share,
  `null` if any counted read is unpriced (I2). `turnIndices` = sorted distinct turn indices.
- **R4 — LOW-confidence framing and savings exclusion (the crux, I6; maintainer directive).**
  Per the maintainer directive (2026-07-06), this ships as a **confidence-marked** signal rather than
  being cut. It carries `confidence: "low"`. **Correct mechanism (S2 re-review 2026-07-06):**
  `isFloored(confidence)` only nulls the savings *denominator* — it suppresses the `%` but NOT the
  `$`, which is summed directly from `WasteLine.usd` (`src/receipt/handoff.ts:63,71`) and re-rendered
  as "could have saved ≤ $…" in the PR body (`src/pr/body.ts:591`). And `WasteLine` currently has
  **no** `confidence` field (`src/receipt/model.ts:61`). Therefore this spec must: **(i)** add a
  `confidence` field to the waste/diagnostic model; and **(ii)** exclude low-confidence signals from
  the recoverable-`$` **sum on both surfaces** — the handoff `$` (`handoff.ts:63`) and the PR-body
  "could have saved" `$` line (`pr/body.ts:591`) — in addition to the existing `%` suppression. Net:
  **neither a `$` nor a `%` "could have saved" is ever attributed to re-reads**, while the diagnostic
  + tokens still render. The line states only what is recorded: `same-file re-reads: N (≈X tokens,
  low confidence) — no recorded edit, compaction, or matching shell command between; may include
  legitimate re-grounding.` Never "wasted"/"avoidable". A test asserts no savings `$` AND no `%` is
  attributed on **both** the handoff and the PR body.
  **Implementation note (2026-07-07):** realized as a **standalone diagnostic block** (R5's
  `sameFileReReads` field on `ReceiptModel`, mirroring `costShape`), NOT a `WasteLine`. It is
  therefore structurally never in `handoff.ts`'s `WasteLine.usd` sum or `pr/body.ts`'s savings line,
  achieving the Net above **by construction** — the (i)/(ii) WasteLine-confidence-exclusion mechanism
  is unnecessary. The `confidence: "low"` field lives on the standalone block, and a test asserts the
  signal is never a `same-file-rereads` waste-row kind. Rendered in `--details` + `--json` only (a
  low-confidence, corpus-gated line stays off the default receipt until R6 is met).
- **R5 — Surfaces (minimal).** Text receipt: the R4 diagnostic line (marked low confidence). `--json`:
  `sameFileReReads: { count, turnIndices, tokens, usd: number | null, confidence: "low" }`. No
  `--handoff` action suggestion in this spec (deferred until the corpus gate proves the signal — S2).
- **R6 — Precision/worth gate via the real-session corpus.** Validate on a ≥20-session labeled
  corpus from the SPEC-0065 session store (or the `scripts/thrash-calibration.mts` pattern). The PR
  reports the no-recorded-cause magnitude and a maintainer spot-check of a flagged sample,
  documenting the false-attribution rate (user-requested re-reads, external-editor and subagent
  edits, and non-shell mutators are known blind spots — R4 wording owns this). Committed fixtures:
  true positive (same path ×3, nothing between); edit-between negative; compaction-between negative;
  basename-shell-between negative; whole-tree-shell (`git checkout .`) negative; different-file
  negative (`src/a.ts` vs `test/a.ts`); failed-read-then-retry negative; unpriced re-read
  (`usd:null`); path-alias positive (`./a.ts` and `a.ts` are the same file).
- **R7 — Determinism (I1).** The block is a deterministic function of the loaded session; ordering
  comes from the global call ordinal, no map/set iteration leaks into output. Telemetry is
  **deferred** to a follow-up once the signal survives R6 (S2: no schema churn for an unproven line).

## Scenarios

- **Given** `Read a.ts` at turns 2, 9, 20 with no edit/compaction/shell touch of `a.ts` between,
  **when** the receipt renders, **then** one neutral `same-file re-reads: 2` line, priced from the
  two later reads, **absent** from any "could have saved" total.
- **Given** `Read a.ts → Edit a.ts → Read a.ts`, **when** it renders, **then** no line.
- **Given** `Read a.ts → shell "git checkout ." → Read a.ts`, **when** it renders, **then** no line
  (whole-tree mutator).
- **Given** `Read a.ts → shell "sed -i … a.ts" → Read a.ts`, **when** it renders, **then** no line
  (basename touch).
- **Given** `Read a.ts → <compaction> → Read a.ts`, **when** it renders, **then** no line.
- **Given** a failed `Read a.ts` then a successful `Read a.ts`, **when** it renders, **then** no
  line (retry, not re-read).
- **Given** `Read src/a.ts` and `Read test/a.ts`, **when** it renders, **then** no line (different
  files).
- **Given** `Read ./a.ts` then `Read a.ts` with nothing between, **when** it renders, **then** one
  re-read (path aliases resolved).
- **Given** an unpriced session with no-recorded-cause re-reads, **when** it renders, **then**
  tokens with `usd: null`.
- **Given** a codex/cursor session (no `Read` tool), **when** it runs, **then** it never fires.

## Non-goals

- **Attributing a recoverable `$`/`%` "could have saved" to re-reads** (I6) — the signal ships at
  low confidence, which suppresses the savings figure via the existing floored path (R4); the
  diagnostic + tokens show, the savings claim never does.
- **Byte-identical `duplicate-reads`** — cut; superseded.
- **Any "$ wasted"/"avoidable" verdict** — the caveated fact is the ceiling of what the transcript
  supports; external edits, user-requested re-reads, subagent edits, and non-shell mutators cannot
  be excluded (owned in R4/R6 wording).
- **Cross-file content-hash dedup** — the transcript records the call, not file bytes (I1).
- **Non-`Read` tools / non-Claude adapters** — silent by design.
- **Telemetry and `--handoff` suggestion** — deferred until the R6 corpus gate passes.
- **User-configurable exclusions/thresholds** — none until a false-attribution log demands them.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 same-path any range | one path, differing `offset` | same file |
| R1 path aliases | `./a.ts` vs `a.ts` vs `src/../a.ts` | same file |
| R1 different dirs | `src/a.ts` vs `test/a.ts` | different files, no fire |
| R1 failed-then-retry | error `Read` then ok `Read` | retry, not a re-read |
| R1 non-Claude | codex/cursor | no fire |
| R2 fires | same path ×3, nothing between | 2 counted |
| R2 edit-between | `Read → Edit path → Read` | 0 |
| R2 basename-shell | `Read → sed -i …path → Read` | 0 |
| R2 whole-tree shell | `Read → git checkout . → Read` | 0 |
| R2 compaction-between | `Read → compact → Read` | 0 |
| R2 same-turn ordering | multiple ordered calls in one turn | ordinal within the turn respected |
| R3 pricing | priced re-reads | summed share, real `usd` |
| R3 unpriced | one counted read unpriced | tokens only, `usd:null` |
| R4 no-savings handoff | fixture that fires | no `$` AND no `%` "could have saved" from re-reads in `handoff.ts` (both the usd sum and %) |
| R4 no-savings PR body | fixture that fires | no `$` AND no `%` from re-reads in `pr/body.ts` "could have saved ≤ $…" |
| R4 confidence field | fixture that fires | `confidence:"low"` present on the model + json + line; low-confidence excluded from recoverable-$ by construction |
| R5 json shape | fixture | top-level `sameFileReReads` block, not a `waste[]` row |
| R5 handoff | fixture | `--handoff` unchanged (no suggestion this spec) |
| R6 corpus | ≥20 labeled sessions + spot-check | magnitude + false-attribution rate documented |
| R7 determinism | same transcript ×2 | byte-identical |

## Success criteria

- [ ] Fires on the true-positive and path-alias fixtures; silent on edit/compaction/basename-shell/
      whole-tree-shell/different-dir/failed-retry negatives.
- [ ] A test asserts the fact never enters handoff/PR "could have saved" and carries no "wasted/
      avoidable" phrasing (I6, S2's biggest risk).
- [ ] ≥20-session labeled corpus (SPEC-0065 store) reported with a maintainer spot-check and the
      false-attribution rate written into the PR.
- [ ] `usd: null` on every unpriced finding (I2); pre-existing goldens pass unregenerated (I5).
- [ ] Telemetry and handoff suggestion explicitly deferred (not added here).
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, `node scripts/spec-lint.mjs` all pass unmasked (`echo $?`).

## Validation

**2026-07-06 · S1 (self):** clean on I2/I5; missed the "could have saved" leak and the
"genuinely unexplained" overclaim that S2 caught.

**2026-07-06 · S2 (Codex): reworked, findings accepted.** Applied: wording "genuinely unexplained"
→ "no **recorded** edit/compaction/matching shell command" [#1]; **not a `WasteLine`** — kept out of
handoff/PR "could have saved" as its own neutral block [#5, the biggest risk]; implement inside
`waste.ts` extending the private `FlatCall` with raw name/input/shell + global ordinal, compaction
as a synthetic pre-turn ordinal — no exported privates [#3]; path normalization resolves `.`/`..`
but does not equate different dirs/basenames [#2]; failed-read-then-retry excluded [#2]; whole-tree
shell mutators (`git checkout .`/`reset`/`apply`, `prettier --write`, `find -exec`) added to the
exclusion list to shrink false attribution [#4]; telemetry and handoff suggestion **deferred** until
the corpus gate [#6]; test rows added for aliases, different dirs, failed-retry, same-turn ordering,
whole-tree shell, and the not-a-waste-line assertion [#2]. Residual blind spots (user-requested
re-reads, external-editor/subagent edits, non-shell mutators) are owned explicitly in R4/R6 wording,
not hidden [#4].

**2026-07-06 · S3 (worth): who + how often** — every substantial Claude Code session; measured 23%
no-recorded-cause re-reads across 25/38 real sessions, corroborated by independent arXiv/practitioner
evidence. **do-nothing** — the single biggest agent-cost pattern stays invisible on the receipt.
**smaller fix** — none captures it. **steelman the cut** — the honesty caveat could make it "too
hedged"; countered by keeping it a diagnostic (not a savings claim), where a caveated count is
exactly right. **kill-criterion dry-run** — local data already suggests it survives; the corpus gate
+ spot-check (R6) confirms before it ships.

**Verdict: BUILD NOW**, pending the R6 corpus gate before the line ships to users.

**2026-07-06 · Amendment (maintainer directive, post-approval).** Reframed from "excluded neutral
diagnostic" to a **low-confidence signal** (`confidence:"low"`) per the maintainer's prefer-confidence-
over-cutting directive. This preserves S2's core catch — the forbidden thing was the *savings claim*,
not the signal — by routing it through the existing `isFloored(confidence)` path so no `COULD HAVE
SAVED` `$`/`%` is ever attributed to re-reads (R4), while the diagnostic + tokens still show. The
strong caveat and R6 corpus gate are unchanged.

**2026-07-06 · S2 re-review (Codex) of the amendment — bug found and fixed.** The first amendment
claimed low confidence would suppress the savings `$` via `isFloored`; Codex proved that false —
`isFloored` nulls only the `%` denominator, while the `$` is summed directly from `WasteLine.usd`
(`handoff.ts:63,71`) and re-rendered in `pr/body.ts:591`, and `WasteLine` has no `confidence` field
at all. R4 corrected: add a `confidence` field to the model and **exclude low-confidence signals from
the recoverable-`$` sum on both handoff and PR body** (not just the `%`). Test matrix split into
per-surface `$`-and-`%` assertions. Re-lint passes.

**S4 (spec-lint): pass.**
