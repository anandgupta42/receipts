# Why the README is shaped the way it is (SPEC-0029 evidence note)

The README's structure and the guard test's budget constants
(`test/readme-guard.test.ts`) come from two evidence tiers, summarized here
so the shape is explainable from inside the repo. Full research report:
maintainer's vault, 2026-07-03.

## Tier 1 — hand-measured corpus: 22 HN front-page launches, Apr–Jul 2026

Method: HN Algolia API, `Show HN` ≥200 points with github.com URLs
(34 found, top 22 by points fetched via GitHub API and measured
structurally). Success-only sample, no control group; regex-level
measurement; single 3-month window.

| Metric | Corpus value | README consequence |
|---|---|---|
| Visual in first 30 lines | 86% | hero `<picture>` of golden SVGs, first screen |
| Animated/terminal cast | 1 of 22 | static image, no GIF |
| Quantified tagline | 14% | plain human register, no forced number |
| Emoji per README | median 0.5; 73% ≤2 | `MAX_EMOJI = 2` (title 🧾 + receipt 🥟) |
| Length / lists / links / code blocks | 240 / 20.5 / 9.5 / 10 (medians) | `MAX_LINES = 260`; density is review guidance, not a gate |
| Badges present | 55%, median 1 | `MAX_BADGES = 3`, light row |
| Install in first 60 lines | 64% | guard asserts ≤ line 60 |
| Contributing at launch | 27% | short section, links CONTRIBUTING.md |

## Tier 2 — peer-reviewed correlates (pre-2023 data, correlational)

- JSS 2023 (n=5,000): list count and README **update frequency** are the
  strongest popularity discriminators. The parity guard converts every
  receipt-output change into a forced, visible README update — cadence by
  construction.
- arXiv 2206.10772 → SP&E 2025 (n≈2,000, 10 languages): links rank #1 in
  feature importance in every language; images and inline code significant;
  **install-instruction polish does not discriminate** (present in 189/200
  regardless of popularity) — table stakes only.
- arXiv 2603.27249 (Apr 2026, n=1,154 posts): emoji-heavy verbose text reads
  as AI slop to developer reviewers — the cap is a trust decision, not taste.

## The one rule that outlives launch day

Every receipt shown in the README is byte-pinned to a committed golden.
The marketing surface obeys the same invariant as the product (I5): if the
renderer didn't produce it, the README can't show it.

## Prior art & the prepared launch-thread reply (SPEC-0030 R2)

Positioning rules: never argue priority or state of mind; cite the lineage
(ccusage → claude-receipts → Infracost-for-infra); make the difference
categorical ("a souvenir vs bookkeeping"). Facts checked 2026-07-03:
claude-receipts created 2026-01-29, 616 stars, no HN front-page moment
(4 and 1 points on its two submissions), thermal-printer novelty over
ccusage, Claude-only, by its author's own README "a creative side project."

Paste-ready reply for "this already exists":

> claude-receipts is great — it's in our Related Work next to ccusage,
> which powers it. Different jobs though: claude-receipts is a souvenir (a
> thermal-printed memento of a Claude Code session; go see the photos,
> they're wonderful). aireceipts is bookkeeping: its own parsers across
> Claude Code / Codex / Cursor / opencode, prices from cited and dated
> tables that CI verifies, byte-deterministic output, and PR-level
> attribution — every PR in our repo carries the receipt of the agent
> sessions that built it, with explicit floors when anything can't be
> proven, and a doc on what a receipt can and can't prove. Same good
> metaphor — Infracost did it for Terraform PRs years ago — different
> category of tool.

If someone asks directly whether the author knew of claude-receipts:
answer truthfully in one sentence and move on — this file's git history
timestamps when it was found and credited. Never volunteer state-of-mind
as a defense; the lineage and the categorical difference are the defense.
