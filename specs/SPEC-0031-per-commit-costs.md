---
id: SPEC-0031
title: "Per-commit cost attribution — the ledger cut at commit boundaries"
status: shipped
milestone: M4
depends: [SPEC-0023, SPEC-0026, SPEC-0027]
---

# SPEC-0031 · per-commit cost attribution

Invariants: I1 (same transcripts + commits → identical tables), I2 (segments
price with the existing per-turn machinery; no new dollar sources), I3 (the
segmentation convention is named on every surface that shows it), I6 (facts
per commit, never "this commit was worth it").

## Purpose

Maintainer ask (2026-07-03): *"the receipts should show the total sum of
cost of all the commits and also a way to see per commit cost."* Totals
already sum every contributing session's PR slice; the missing cut is
per-commit. The data requires no new estimation: attribution already finds
each branch commit's SHA as an anchor turn inside a session, so segmenting
the sliced turns at anchor boundaries yields a **ledger convention** (not a
causal claim — rebases, amends, and prepared-ahead work exist): each sliced
turn is booked to the commit whose anchor comes next. Same arithmetic the
slice already prices, cut at boundaries. `computeSlice` ends the slice at
the last own anchor (`src/pr/slice.ts:116`), so segments PARTITION the
slice completely — there is no "after" remainder inside PR accounting, and
post-final-commit work stays outside the PR receipt exactly as SPEC-0019
designed.
Placement follows the session's layered design: the fence stays untouched;
the per-commit table lives on the artifact page (SPEC-0027 — "more
interesting insight, one click away") and in the artifact's inert JSON
island; the fence and details section are frozen.

**Kill criterion:** (a) reconciliation is absolute — for every session, the
sum of its commit segments must equal its slice total token-exactly and
USD-within-epsilon (ledger property in the suite; any drift fails CI); (b) if dogfood shows the per-commit table misleads more than it
informs (maintainer judgment on this repo's own PRs), the table demotes to
`--json` only and the spec records why.

## Requirements

- **R1 — Segmentation, deterministic and convention-named.** Within a
  contributing session's rendered slice, turns are assigned to the commit
  whose anchor turn is the NEXT anchor at-or-after them ("turns preceding
  each commit anchor belong to that commit"). Segments price via the
  existing sliced-model machinery — no new pricing paths (each segment is
  priced by `buildReceiptModel` over its sub-slice, the same seam the
  slice itself uses). The anchor data needs a new exported seam:
  `anchorEvents(turns, branchShas): { turnIndex, shas }[]` in
  `src/pr/slice.ts` (today `classifyBranchAnchors` returns only booleans/
  counts — insufficient, measured). A turn whose output anchors MULTIPLE
  commits attributes to the **chronologically earliest** branch commit
  among them (branch order from `branchCommits`, reversed from git log's
  newest-first) and the table notes `+N more in this turn`. Sessions with
  zero anchors (helpers, promoted full-fallbacks) are not
  commit-attributable and appear once under `not commit-attributable`,
  session-labeled — never guessed onto commits.
- **R2 — Commit metadata rides the existing git call.** `branchCommits`
  (`src/pr/git.ts:90`) switches its format to NUL-delimited fields
  (`%H%x00%cI%x00%s`) so subjects containing `|`/tabs cannot corrupt
  parsing, captures the first-line subject under the same commit cap the
  SHA list already uses, and display caps subjects at 72 codepoints. No
  new git invocations.
- **R3 — Surfaces.** (a) Artifact page (`src/pr/html.ts`): per session with
  ≥1 anchor, a table `commit · turns · cost` (or tokens when unpriced, I2)
  between the session label and its full receipt, followed by the bucket
  rows; a one-line methodology note under each table naming the R1
  convention. (b) The details
  section does NOT change (cut per S2: duplicating the table there
  stresses the size cap for no reader gain — the artifact is one click
  away and `--json` tooling has the template island). (c) `--json` for `aireceipts pr` is
  out of scope until `pr` grows a `--json` mode; instead the artifact
  embeds the exact table data as JSON inside an inert
  `<template id="per-commit">` element — the artifact's script-free
  contract (`test/pr/artifact.test.ts:30` bans `<script`) stays intact,
  and tooling parses the template content. The fence does NOT change (round-2 grammar is
  frozen; kill criterion b of SPEC-0026 applies).
- **R4 — The reconciliation property.** A fast-check ledger test through
  the real segmentation: token counts reconcile EXACTLY (integers); USD
  reconciles to within a fixed 1e-9 epsilon (float association only —
  per-turn values are floats summed in different groupings;
  `src/pricing/attribution.ts:60`), and the DISPLAYED per-commit values
  derive from segment sums the same way every other surface displays
  (`formatUsd`). The red path (a dropped or double-counted turn) must
  fail it.

## Scenarios

- **Given** a session whose slice contains anchors for commits A then B,
  **then** turns up to A's anchor attribute to A and turns after it up to
  B's anchor (the slice end) attribute to B — a complete partition.
- **Given** one turn whose output carries anchors for A and B (a single
  `git push` landing both), **then** the turn attributes to A and the
  table notes `+1 more in this turn` on that row.
- **Given** a codex helper with no anchors, **then** it appears only under
  `not commit-attributable` — no per-commit rows are invented for it.
- **Given** the same PR rendered twice, **then** tables and data island are
  byte-identical (I1).

## Non-goals

- **Fence changes** — the concise receipt's grammar is frozen (SPEC-0026
  round 2); per-commit lives one click down.
- **Cost-per-diff-line or any commit "value" metric** (I6 — facts, not
  judgments).
- **Cross-session merging of a commit's cost.** A commit's anchor lives in
  exactly one session (the one that made it); no cross-session summing is
  invented.
- **`aireceipts pr --json`** — a separate CLI-surface spec if wanted; the
  data island covers tooling until then.
- **Time-based segmentation for anchorless sessions** (SPEC-0019's "time is
  a filter, never the slicer" still stands).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 boundaries | anchors at slice turns 3 and 7 (slice ends at 7) | turns 0–3 → A, 4–7 → B; partition complete |
| R1 multi-anchor turn | one turn carrying A+B anchors | attributed to the chronologically earlier commit; `+1 more in this turn` noted |
| R1 anchor-events seam | fixture turns | `anchorEvents` returns per-turn matched SHAs in transcript order |
| R1 pricing reuse | any segment | segment totals equal `buildReceiptModel` over the same sub-slice |
| R1 anchorless session | helper in the set | listed under `not commit-attributable` only |
| R1 unpriced segment | segment with no cited price row | tokens shown, no `$` (I2) |
| R2 subjects | branchCommits fixture | sha+subject captured in the same git call |
| R2 hostile subject | subject containing `\|` and a tab | parsed intact (NUL-delimited); display capped at 72 |
| R3 artifact table | session with 2 anchors | table rows + methodology note between label and receipt |
| R3 template island | artifact html | `<template id="per-commit">` JSON matches table data; artifact stays `<script`-free |
| R3 convention named | artifact html | the R1 convention note renders under each table |
| R3 bucket labeled | anchorless session in set | `not commit-attributable` row carries the session id |
| R3 details unchanged | details section bytes | identical to pre-feature for same input |
| R3 fence frozen | fence bytes with feature on | unchanged vs pre-feature for same input |
| R4 ledger | fast-check arbitrary anchors | tokens exact; USD within 1e-9; red path fails |
| determinism | same fixtures ×10 | byte-identical artifact + body |

## Success criteria

- [ ] This spec's own implementation PR shows a real per-commit table on
      its artifact page for the session that built it. **Dogfood finding
      (2026-07-03, honest miss):** the builder was a FORK whose transcript
      lives at `<parent-session>/subagents/*.jsonl` — a nested path session
      discovery never globs, so the building session (and its commit
      anchors, verified present in the file) is invisible to attribution
      entirely. Pre-existing gap, out of this spec's scope (discovery, not
      segmentation); surfaced to the lead for the attribution backlog
      alongside SPEC-0032. The criterion is demonstrated by the committed
      golden and the e2e path instead; the box stays unchecked until a
      non-fork session dogfoods it live.
- [ ] Ledger property green; red path demonstrated in the PR.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass
      unmasked (`echo $?`).

## Validation

**2026-07-03 · S1 (self):** the convention is deterministic over data the
product already parses; every surface is byte-testable; no new pricing
paths. The one wording risk — implying causal attribution — was flagged by
S2 and fixed (ledger convention, stated on-surface).

**2026-07-03 · S2 (Codex, read-only, full capture): REWORK → reworked.**
9 findings, ALL accepted:
1. HIGH — the `after <sha>` bucket contradicted `computeSlice` (slices end
   at the last anchor) — bucket cut; segments now partition the slice, and
   post-final-commit work stays outside PR accounting by SPEC-0019 design.
2. HIGH — `classifyBranchAnchors` exposes no per-turn SHAs — new exported
   `anchorEvents` seam specified.
3. HIGH — raw-float "exact" USD reconciliation over-specified — now
   token-exact + 1e-9 epsilon for USD, display via `formatUsd`.
4. HIGH — multi-anchor "first" undefined — defined as chronologically
   earliest branch commit; tested.
5. MEDIUM — script data island conflicted with the artifact's `<script`
   ban — carrier switched to an inert `<template>`.
6. MEDIUM — `%s` on a `|`-delimited format corrupts — NUL-delimited fields
   + 72-codepoint display cap + hostile-subject row.
7. MEDIUM — missing rows (convention note, labeled bucket, pricing reuse,
   hostile subject) — added.
8. LOW — "exactly the work that produced each commit" overclaimed — now a
   named ledger convention.
9. CUT — details-section per-commit lines — cut (size-cap pressure, no
   reader gain; artifact + template island cover it).

**2026-07-03 · S3 (value gate):** the ask is the maintainer's, verbatim, and
the kill criterion's reconciliation gate is the same ledger discipline
SPEC-0028 shipped — evidence it is enforceable exists in the suite today.

**2026-07-03 · S4 (lint):** `node scripts/spec-lint.mjs` → 30 spec(s) OK,
exit 0.

**2026-07-03 · approved (button 1):** maintainer, in-session ("all specs approved").

**2026-07-03 · S5 (implementation review, Codex, full capture): REWORK → fixed.**
1. HIGH — `branchCommits` was read twice (selection + tables), risking
   desync and violating R2's same-call rule — accepted; one `branchInfo`
   object now feeds both.
2. MEDIUM — a short SHA prefix matching MULTIPLE branch commits silently
   picked the newest — accepted; ambiguous prefixes are now skipped
   (un-attributed beats guessed, I3).
3. MEDIUM — HTML-escaping the template island made its raw content
   non-JSON — accepted; the island now unicode-escapes `&<>` inside the
   JSON text (simultaneously valid JSON and breakout-proof; hostile
   `</template><script>` subject test added).
4. LOW — literal NUL bytes made the test file binary to git — accepted;
   source escapes now.
5. LOW — freeze coverage weak + a Purpose leftover still promised details
   lines — accepted; Purpose corrected (fence AND details frozen), and the
   critic's own no-additivity-bug finding is recorded: table math uses only
   `totalTokens`/`totalUsd`, which are pure per-turn sums.
Critic's independent conclusion: "I did not find a token/USD additivity
bug in the row math." Gates re-run green after rework.

**2026-07-04 · shipped:** merged via #79; ledger sweep pre-release.
