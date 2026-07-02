---
id: SPEC-0005
title: "Price-table vendor breadth — flat-rate rows for Google/DeepSeek (+ xAI if citable)"
status: approved
milestone: M2
depends: [SPEC-0001]
---

# SPEC-0005 · Price-table vendor breadth

Invariants: I2 (no price without a matching dated row), I3 (every row cited), I6
(facts, never rankings — two priced receipts, never a hardcoded comparison claim).

## Purpose

`compare` becomes most useful when both frontier and budget vendors resolve to real
prices — two *actual priced receipts* side by side, each number traceable to a cited
row. No marketing claim is baked anywhere; the receipts speak (S2 finding: the earlier
"$7 vs $0.40" phrasing was ranking-flavored and is gone).

## Requirements

- **R1 — Flat rows only.** Add vendor tables ONLY for models whose official page
  publishes a flat, context-independent standard text-token rate that fits the schema
  (input / output / cache-read, cache-write where published). Tiered-by-context,
  priority/batch, and tool-priced dimensions are OUT (S2: Google/xAI pages carry tiers
  our schema can't honestly hold). A model with only tiered pricing is omitted, listed
  in the table's `omitted` note with the reason. Target vendors: Google (flat-rate
  models only), DeepSeek; xAI only if its page yields unambiguous flat rows.
- **R2 — One vendor per PR.** Each vendor lands as its own PR via the update-prices
  discipline (`sources: [{url, observed_at, excerpt}]` — excerpt REQUIRED for new-vendor
  rows so a reviewer verifies the number without re-fetching).
- **R3 — cite-check upgrade.** Implement URL liveness in `scripts/cite-check.ts` (GET,
  expect 2xx/3xx, offline-tolerant in local runs, enforced in CI) + require non-empty
  `excerpt` on rows newer than the check. Price-appears-on-page matching stays TODO;
  the PR body must include the manual verification note (lead's price-check duty).
- **R4 — Resolution mapping + tests.** Extend model-id→vendor resolution for the landed
  vendors' id formats; table-driven resolution tests run for EVERY landed vendor file
  automatically (no per-vendor test authoring — S2 finding); unknown ids stay
  tokens-only.

## Non-goals

Local/open-weight models; aggregators/routers (plan-dependent pricing); historical
back-fill; tiered/long-context pricing dimensions (schema-extension spec if ever);
auto-refresh scheduling (the daily loop, later).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 flat-only | each landed vendor json | rows fit schema; `omitted` note lists tiered models |
| R2 cited rows | each landed vendor json | cite-check green; url+observed_at+excerpt on every row |
| R3 liveness | CI run | every cited URL returns 2xx/3xx |
| R4 resolution (table-driven) | fixture ids per landed vendor | correct row by date; unknown id → tokens-only, zero `$` |
| R4 hook | uncited row write attempt | blocked (exit 2) |

## Success criteria

- [ ] ≥2 vendor tables landed (own PR each) with official citations + excerpts.
- [ ] `compare` on a frontier-priced and a budget-priced fixture renders two fully
      priced receipts (feeds SPEC-0004's compare asset).
- [ ] Unmasked gate + spec-lint + prices CI job (incl. liveness) green.

## Validation

**2026-07-02 · S1:** purpose reworded to two-actual-receipts framing (I6). **S2
(Codex):** verdict REWORK → reworked same day. Accepted: flat-rows-only constraint with
`omitted` notes (Google/xAI tier reality); one-vendor-per-PR reconciled with the ≥2
success criterion; cite-check URL-liveness implemented as part of this spec + required
excerpts (closing the shape-only gap); table-driven per-vendor resolution tests.
**S3:** cheap-model efficiency zeitgeist evidence (cost-wave research); compare demand.
**S4:** spec-lint green.
