# Research: full-receipt details that drive adoption (SPEC-0054)

*2026-07-05. Method: 10-agent research workflow — 4 parallel researchers (adoption-surface
UX, competitor scan, community pain, codebase inventory), 3 ideation lenses
(actionability, shareability, trust), 3 adversarial judges (invariants, worth,
implementation reality). 28 candidate ideas; 26 survived ≥2 judges; the composition
below is the top consensus cluster.*

## What the research found

**Adoption surfaces (cost-diff PR bots, Codecov, size-limit, Lighthouse CI, npm audit,
Receiptify/Wrapped, GH job summaries):**
- Every number should carry its delta/context, not sit alone — Codecov renders
  `absolute <relative> (impact)`; cost-diff PR bots lead with the diff and its cause
  (docs.codecov.com/docs/pull-request-comments).
- Progressive disclosure is a first-class feature: short scannable top, full detail
  behind an expand (Codecov `condensed_*` modes; GH `<details>` guidance —
  github.blog "Supercharging GitHub Actions with job summaries").
- Reports that prescribe the next action outperform reports that state facts
  (npm audit prints the fix command; size-limit translates bytes into 3G load time).
- Receiptify/Wrapped virality mechanics: the familiar-artifact framing + a stat
  specific enough to feel personal; regenerable views drive re-sharing
  (nogood.io/blog/spotify-wrapped-marketing-strategy).

**Adjacent usage dashboards and observability tools:**
- Standard stat lines we lack: input/output/cache-read/cache-write composition,
  per-model cost split, burn rate, per-session token shape.
- Their burn rates are live forward projections — banned here (I1/I3); the safe
  subset is historical arithmetic labeled as such.

**Community pain (HN, r/ClaudeAI, r/ChatGPTCoding, GitHub discussions):**
- #1 recurring question: "why is my input 2M tokens / is caching actually working" —
  answered by a composition line, not a single cache-served %.
- Cache-write pricing has no mental model (5m vs 1h TTL rates); a silent TTL default
  change blindsided users.
- "Is my number normal?" — needs session shape (turns, tool calls, peak turn) next
  to the dollar figure.
- Waste findings without a location aren't actionable — users want "go look at
  turns 12–16", which we compute (`StuckLoopFinding.turnIndices`) and discard.

**Codebase inventory:** 25 unsurfaced fields; the notable ones — `turnIndices` on
stuck loops, `actualUsd` on the price delta (percentage is free), `TokenUsage`
composition incl. optional `cacheCreation5m/1h`, `turnCount`/`toolCallCount`,
per-turn usage (peak turn), `priceRowsUsed` (rates + dates), `ToolCall.status`
(deferred). Seams: `present.ts` builders + existing block kinds render in text AND
SVG for free; the honesty battery (`validateReceiptBlocks`) forces every new `$`
into `tracedDollarAmounts`.

## Judge-ranked consensus (top cluster → SPEC-0054)

| Idea | Keeps | Avg | Disposition |
|---|---|---|---|
| Price-delta percentage | 3/3 | 8.0 | R1, default-on |
| Stuck-loop turn locations | 3/3 | 7.7 | R2, default-on |
| Token composition (in/out/cache r/w) | 3/3 | 7.2 | R4, `--details` |
| Turn/tool-call counts | 3/3 | 6.8 | R4 (opt-in, not default — crowding) |
| Priced-coverage caveat | 3/3 | 6.7 | R3, conditional default |
| Cache counterfactual (arithmetic) | 3/3 | 6.2 | R4, price-delta-shaped labeling |
| Per-model $ split | 3/3 | 6.2 | R4, conditional, cent-reconciled |
| Peak turn size | 3/3 | 6.0 | R4 |
| Burn rate + avg/turn | 3/3 | 5.3 | R4, "arithmetic" label load-bearing |
| Price provenance footnote | 3/3 | 5.3 | Deferred — `--json` has it; revisit |
| Cache TTL-split sub-line | 2/3 | 6.0 | R4 sub-line, absent ≠ 0 |
| Per-tool error counts | 2/3 | 5.7 | Non-goal (false-positive risk) |
| Session-shape superlatives | 2/3 | 5.0 | Non-goal (needs floors/design) |

Judge 3's structural verdict, adopted wholesale: compose every opt-in stat into ONE
`--details` flag adding ONE section built from existing block kinds; default-output
changes only where a line already fires (no unconditional new default line).

Full research payload (18 + 11 + 15 findings with URLs, 25-field inventory, all 28
ideas + 3×28 verdicts) is preserved in the session workflow transcript; this file is
the durable summary.
