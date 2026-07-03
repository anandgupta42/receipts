---
id: SPEC-0026
title: "PR comment polish — leaner N=1, cache line, honest helper label, details on demand"
status: building
milestone: M3
depends: [SPEC-0023, SPEC-0024]
---

# SPEC-0026 · PR comment polish

Invariants: I1 (deterministic body), I2/I3 (no new money semantics; every added
line is computed from already-counted tokens or restates existing honesty
labels more precisely), I6 (role display changes only; the taxonomy and its
structural derivation are untouched).

## Purpose

Maintainer review of PR #58's live receipt (2026-07-03) named four paper cuts
and one missing capability in the PR comment — all display-layer, all in
`src/pr/body.ts` + `src/pr/comment.ts`:

1. Single-session PRs render a role prefix (`builder ·` / `orchestrator ·`)
   that differentiates nothing — the maintainer flagged it as setup-specific
   noise for the N=1 case.
2. The full receipt's `cache served N% of input tokens` masthead line
   (`src/receipt/present.ts:71`) never made it into SPEC-0023's comment
   layout — the maintainer asked where it went.
3. `entire session (slice unavailable)` (`FULL_FALLBACK_LABEL`,
   `src/pr/slice.ts:11`) reads as a failure. For a Codex helper credited on
   cwd+time with **zero git writes**, the whole session *is* the correct
   scope — the label should state the fact, not apologize.
4. Nothing in the comment tells a reader how to get the full per-tool story
   (maintainer: "run <cmd> to get more details").
5. The full story itself should be one click away without hosting anything:
   a collapsed `<details>` section in the same comment (the maintainer's
   alternative — rendered HTML on an artifact branch — is deliberately
   deferred, see Non-goals).

**Kill criterion:** (a) if in dogfood the expanded comment ever exceeds
GitHub's 65,536-char comment limit despite R5's cap, or anything other than
the marker line renders before the concise fenced receipt, the `<details>`
section is cut back to the R4 hint line alone; (b) if the R3 helper label ever renders on a session
that made a git write, that is an honesty bug — R3 reverts to
`FULL_FALLBACK_LABEL` everywhere until fixed.

## Requirements

- **R1 — Role suppressed at N=1.** When exactly one contributor renders (auto
  or `--session`), its row label is the model mix alone (`claude-opus-4-8
  100%`), no role prefix. With two or more contributors, rows keep
  `<role> · <mix>` unchanged. `deriveRole` and the Role type
  (`src/pr/contributors.ts`) are untouched (I6) — this is display-only in
  `src/pr/body.ts`'s `contributorBlocks`.
- **R2 — Aggregate cache line.** A muted note under the `counted:` line:
  the cache-served formatter of `src/receipt/present.ts:56-72` applied to
  the summed `TokenUsage` of every counted atom — the same atom set
  `collectAtoms` walks (`src/pr/body.ts:133`), including readable subagent
  rows; the `TokenUsage` summation itself is new code (today `totalsFor`
  folds only subtotals/counts). Same display-honesty rules: absent when
  `cacheRead <= 0`; a partial ratio never rounds up to `100` (`>99`
  boundary preserved). The formatter is extracted to take a `TokenUsage`
  and reused by both surfaces — reviewers reject a duplicated
  implementation (structural, enforced at review; the parity row is the
  behavioral check).
- **R3 — Honest helper label.** A contributor credited by the SHA-less Codex
  helper rule (own anchor absent, `writeCount === 0` — computed and currently discarded
  by `selectContributors`, `src/pr/contributors.ts:95`, so retaining it is
  part of this change) renders
  its provenance line as `entire session (no commits to slice by)` instead of
  `entire session (slice unavailable)`. The attribution basis travels on
  `RawContributor` → `ContributorView`; every other full-session fallback
  (anchored session whose slice can't be cut) keeps `FULL_FALLBACK_LABEL`
  byte-for-byte.
- **R4 — Footer hint.** One muted line at the bottom of the fenced receipt,
  after the counted/excluded notes: `details: npx aireceipts --session <id>`
  (literal `<id>`; the per-session ids are already on the provenance lines).
  Always present in the PR body; never in the terminal receipt surface.
- **R5 — Collapsed full receipts, size-capped.** After the fenced concise
  receipt, the comment gains a `<details><summary>full receipts (N
  sessions)</summary>` section containing, per contributor in render order,
  one fenced full receipt — the same bytes `renderReceipt` produces for that
  contributor's sliced model (color off, `RECEIPT_WIDTH`), i.e. what
  `aireceipts --session <id>` shows for the slice. The `DOGFOOD_MARKER`
  stays the first line and the upsert (`src/pr/comment.ts`) is unchanged.
  `aireceipts pr --no-details` omits the section (flag on `PrOptions`,
  `src/pr/index.ts:23`, parsed through `src/cli/options.ts:10` and wired in
  `src/cli/commands/pr.ts:7` — a new CLI flag, so it gets the SPEC-0018
  registry help text and an e2e dispatch test). If the assembled comment would exceed 65,000
  chars, per-session receipts are dropped from the END until it fits, each
  replaced by one muted line `full receipt omitted (comment size limit)`;
  if it still does not fit with every receipt omitted, the whole `<details>`
  section is dropped. Deterministic, never mid-receipt truncation. The cap
  governs the details section only — a concise body that alone exceeded the
  limit would be a pre-existing SPEC-0023 condition, out of scope here.

## Scenarios

- **Given** a PR built by one session, **when** the comment renders, **then**
  the row reads `claude-opus-4-8 100% … $X` with no role, the body still says
  `1 session behind this PR`, and the details section holds one full receipt.
- **Given** three contributors, **when** the comment renders, **then** roles
  render exactly as today and the details section holds three fenced receipts
  in row order.
- **Given** counted atoms whose summed `cacheRead` is positive, **when** the
  totals render, **then** one muted `cache served N% of input tokens` line
  appears under `counted:`; **given** zero `cacheRead`, no line.
- **Given** a Codex helper with no git writes, **then** its provenance reads
  `entire session (no commits to slice by)`; **given** an anchored session whose slice
  falls back, **then** it still reads `entire session (slice unavailable)`.
- **Given** `--no-details`, **then** the comment is the fenced receipt only
  (plus marker), byte-identical to today's body apart from R1–R4.
- **Given** contributors whose combined details would exceed the size cap,
  **then** trailing receipts are replaced by the omission note and the
  comment stays under 65,000 chars.

## Non-goals

- **Hosted/rendered HTML artifacts on a shared branch.** Deferred until the
  `<details>` section proves insufficient: it adds per-PR commits to a shared
  branch from contributors' machines and a wider privacy surface (full
  render exposes more than the curated comment). Revisit on demand.
- **Role taxonomy or derivation changes** (I6). Display-only.
- **Time-window slicing for anchorless sessions.** SPEC-0019's "time is a
  filter, never the slicer" stands; R3 relabels honestly, it does not guess
  a slice.
- **Terminal receipt changes.** `aireceipts` / `--session` output is
  untouched; goldens must not change.
- **Comment pagination / multiple comments.** One marked comment remains the
  contract (SPEC-0019 R2); size pressure is handled by omission, not spam.

## Design (lead-authored — implementers execute, never invent)

Rendered mockups: https://claude.ai/code/artifact/6067cce8-25fa-467e-a36d-42190f15e003
(before/after pairs built from PR #58's real numbers). The normative line
design, in render order inside the fenced block:

```
            3 sessions behind this PR          ← unchanged (R1: N=1 drops role on the row only)
<role> · <mix>........................$X       ← N≥2 rows unchanged
<mix>.................................$X       ← N=1 row, no role prefix (R1)
  session: <id>                                ← unchanged muted provenance
  entire session (no commits to slice by)      ← R3, helper-credited only
  entire session (slice unavailable)           ← unchanged for anchored fallbacks
--------------------------------------------------
TOTAL priced..........................$X       ← unchanged
  counted: N sessions [+ M subagents]          ← unchanged
  cache served N% of input tokens              ← R2, muted, only when cacheRead > 0
  <existing excluded-candidates note>          ← unchanged, stays above the hint
  details: npx aireceipts --session <id>       ← R4, muted, always last note
```

After the fenced block (R5):

```
<details><summary>full receipts (N sessions)</summary>

<one fenced full receipt per contributor, row order — the renderer's exact
bytes for the sliced model (color off, RECEIPT_WIDTH); an omitted receipt
renders as one line: full receipt omitted (comment size limit)>

</details>
```

Copy rules (round 2 supersedes the per-row label): helpers group under one
header — `CODEX HELPERS (N) — no commits` — because the explainer belongs to
the GROUP the credit rule proved things about, not to five identical rows; the hint says `npx aireceipts` (the README's canonical invocation);
the summary line always carries the count so the collapsed state is
informative.

### Round 2 (maintainer dogfood on PR #63's live receipt, 2026-07-03)

The first shipped shape read as "very busy" on a real 6-session receipt, and
flat rows hid the story ("someone will be confused what actually happened
here"). Iterated live over five mockup rounds
(https://claude.ai/code/artifact/6067cce8-25fa-467e-a36d-42190f15e003);
final grammar, maintainer-accepted ("this looks good"):

- **Fence = story.** Top-level rows are sessions that COMMITTED (role at
  N≥2, model mix, cost; their `session slice: turns A–B of N` line stays —
  a sliced cost means something different). The supporting cast indents:
  `SUBAGENTS (N)` as before, and helper-credited sessions under
  `CODEX HELPERS (N) — no commits`, one muted row each carrying its cost
  plus ONE fact beside it: `<model> · <duration>` (a receipt is not a dashboard — time, token
  triples, and labeled token facts were each tried and rejected as busy
  or legend-dependent).
- **No session ids in the fence.** Ids and full-session explainers move to
  the details section's per-session stat line:
  `<role> · <id> · <slice|no commits> · <turns> turns · <dur> · in <k> ·
  out <k> · <cached>% cached` (self-labeling; cache as percent — the
  masthead's own convention). The `npx aireceipts --session <id>` hint
  moves inside the details section next to the ids it needs; the fence's
  last note points at the section (`full receipts + session ids: section
  below`) and falls back to the command hint whenever no section follows
  (`--no-details`, or the size floor dropped it — a hint must never point
  at nothing).
- **`100%` never renders** — a share earns ink only for a real mix, and a
  real mix never rounds a partial share to `100%`/`0%` (`>99%`/`<1%`, the
  cache line's own honesty rule).
- **Details/artifact order mirrors the fence** (authors first, helpers
  after), so the size-cap's drop-from-END sheds helpers before authors.
- **Subagent names sanitized** — a markup-shaped child title (fork
  boilerplate) falls back to `agent-<id>`, the masthead's own rule.
- **Not configurable, deliberately**: one canonical comment shape is the
  trust asset; per-fact knobs fragment the contract and multiply the
  honesty surface. SPEC-0020 templates remain the principled home if
  customization demand ever materializes.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 solo row | one contributor | row label has no role prefix; `1 session behind this PR` kept |
| R1 multi rows | three contributors | `<role> · <mix>` unchanged |
| R2 cache line | atoms with cacheRead > 0 | one muted `cache served N% …` line under `counted:` |
| R2 no cache | all cacheRead = 0 | no cache line |
| R2 parity | same TokenUsage sum | PR-body percentage equals the receipt masthead's for identical usage |
| R2 subagents counted | cacheRead only on a subagent atom | cache line present, reflects the subagent's tokens |
| R2 >99 boundary | summed ratio 0.995..0.999 | renders `>99`, never `100` |
| R3 helper label | helper-credited codex (writeCount 0) | `entire session (no commits to slice by)` |
| R3 anchored fallback | anchored session, slice falls back | `entire session (slice unavailable)` unchanged |
| R4 hint | any body | muted `details: npx aireceipts --session <id>` line present |
| R4 terminal untouched | terminal receipt render | no hint line; goldens byte-identical |
| R5 details | N contributors | `<details>` after the fence with N fenced full receipts, in order |
| R5 marker | rendered comment | first line is still `DOGFOOD_MARKER`; upsert finds exactly one comment |
| R5 opt-out | `--no-details` | no `<details>` section |
| R5 size cap | oversized combined receipts | trailing receipts → omission notes; total < 65,000 chars |
| R5 slice parity | contributor with a real slice | details receipt renders the SLICED model, not the whole session |
| R5 byte parity | any contributor | details receipt bytes equal `renderReceipt` (color off, `RECEIPT_WIDTH`) of that model |
| R5 flag parsing | `aireceipts pr --no-details` through real CLI dispatch | flag accepted; help text lists it |
| R5 cap floor | omission notes alone still too big | whole `<details>` section dropped |
| determinism | same fixtures, 10 runs | byte-identical comment (I1) |

## Success criteria

- [x] This spec's own implementation PR carries the new comment shape: solo
      or multi rows per R1, cache line if applicable, hint line, and a
      working collapsed details section.
- [x] Goldens untouched — the terminal receipt surface did not move (only `goldens/cli/help.txt` and the SPEC-0027 artifact-page golden regenerated, both deliberate).
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, `node scripts/spec-lint.mjs` all pass
      unmasked (`echo $?`).

## Validation

**2026-07-03 · S1 (self):** every line is computed from tokens the body
already counts (cache aggregate) or relabels an existing honesty state (R3);
no predictions, no new dollars, role taxonomy untouched (I6). The one privacy
delta — R5 embeds per-tool receipts in the comment — is bounded by the
existing render-first spine: the author sees the full body on stdout before
any `--post`.

**2026-07-03 · S2 (Codex, read-only): REWORK → draft reworked.** Findings and
disposition:
1. Unmeasurable rhetoric in Purpose/kill criterion — **accepted**; paper cuts
   now attributed to the maintainer's review verbatim, kill criterion (a)
   restated as an observable ordering check.
2. R2 rows missing (subagent inclusion, `>99` boundary); reuse claim
   untestable — **accepted**; rows added, reuse restated as review-enforced
   with the parity row as the behavioral check.
3. R4 terminal-surface row missing — **accepted**; row added (goldens
   byte-identical).
4. R5 rows missing (byte parity with `renderReceipt`, flag parsing/help) —
   **accepted**; rows added.
5. `PrOptions` seam miscited; CLI flag seams uncited — **accepted**; now
   `src/pr/index.ts:23`, `src/cli/options.ts:10`, `src/cli/commands/pr.ts:7`.
6. `totalsFor` "already folds" overstated — **accepted**; reworded (atom set
   from `collectAtoms`; `TokenUsage` summation is new code).
7. R3 needs plumbing, not just display — **accepted**; spec now names the
   discard point (`contributors.ts:95`) and the basis field as in-scope.
8. Size cap could not guarantee fit — **accepted**; cap floor added (whole
   section dropped) and the cap's scope bounded to the details section.
9. R5 called scope creep / 10. weakest, cut it — **rejected**: the collapsed
   details section is the maintainer's explicit ask from the PR #58 review
   ("more interesting insight … someone can go and visit later"); the R4
   command hint serves only the author's machine, not PR readers. R5 stays,
   carrying the extra rows from finding 4 and its own kill-criterion
   fallback to R4.

**2026-07-03 · S3 (value gate):** kill-criterion dry run — (a) size: the
live PR #57/#58 receipts are ~1–2 KB per session; five sessions with full
per-tool blocks stay two orders of magnitude under the 65k cap, and the cap
logic covers the pathological tail; (b) honesty: the R3 label keys on the
same `writeCount === 0` classification that has survived SPEC-0023's
dogfood since PR #49. Cheapest further evidence is built into the success
criteria: this spec's own PR must post the new comment shape.

**2026-07-03 · S4 (lint):** `node scripts/spec-lint.mjs` → 26 spec(s) OK,
exit 0.

**2026-07-03 · round 2 (maintainer dogfood, five design iterations):** fence
grammar reworked as recorded in the Design section; implemented on PR #63's
branch with the deliberate test flips documented in the commit. One honesty
edge found during implementation: the section-pointer hint could dangle when
the size floor dropped the details section — the final body now decides the
hint after the section decision.

**2026-07-03 · S5 (implementation review, Codex): REWORK → fixed.** (1) MEDIUM:
the size-cap budget reserved a hardcoded 200 chars for the artifact link —
accepted; the budget now counts the exact link line + join newlines. (2) LOW:
no dispatch-level test for `--no-details` — accepted; registry
`resolveCommand` assertions added (an empty-HOME `main()` probe was tried and
dropped: adapter roots snapshot at import, so it cannot isolate). The critic
confirmed: R1 test rewrites are the specced flip, R3 basis honesty and the
cache-formatter extraction behaviorally identical, R5 assembly order correct.

**2026-07-03 · approved (button 1):** maintainer, in-session — *"SPEC-0026 -
approved."* Status → building. Build base: PR #63's branch (SPEC-0027 impl),
so R5's details section can also give 0027's link line its final home.
