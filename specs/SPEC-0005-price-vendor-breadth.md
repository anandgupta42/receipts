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

**2026-07-10 · R1 enforcement correction.** The flat `gpt-5.5` and
`gpt-5.6-{sol,terra,luna}` rows violated R1: official model pages state that a
request above 272K input tokens bills the full request at 2× input/cached-input
and 1.5× output, and GPT-5.6 separately bills cache writes at 1.25× uncached
input. The current row and Codex usage schemas cannot select both dimensions
honestly. All four models therefore move to OpenAI's `omitted` list and render
tokens-only until a reviewed context-tier/provider/cache-write schema exists.
Focused resolver tests prove no `$` can escape through these model ids.

**2026-07-10 · explicit-provider safe stop.** Model-family resolution is now a
legacy fallback only when the transcript has no provider evidence. Codex
`model_provider` and opencode `providerID` pin recognized direct-vendor tables;
an explicit router, cloud intermediary, local endpoint, malformed value, or
custom provider blocks dollar pricing and remains tokens-only. This preserves
the aggregator non-goal without accidentally applying first-party rates.

**2026-07-10 · reviewed tier-schema amendment (supersedes the temporary
omission above).** The maintainer accepted an explicitly labeled observable
lower bound instead of requiring invoice-grade exactness. `PriceRow` may now
carry cited, explicit context tiers selected per assistant response by total
prompt input (`input + cacheRead + cacheCreation`) and a provider-generic
cache-write rate. The OpenAI Standard rows for `gpt-5.6-{sol,terra,luna}`
return with their exact `>272,000` per-request boundary and cited short/long
rates. `gpt-5.5` remains omitted: its official page applies the multiplier to
the "full session", a scope the per-request resolver and PR slicing path cannot
select soundly. GPT-5.6 Codex rollouts omit the API's `cache_write_tokens`, so
their observable standard-API-equivalent arithmetic treats the unobserved
write premium as zero and MUST render `≥`, never an exact-looking `$`. The
same visible lower-bound qualifier applies to every computed dollar surface:
the engine may test exact token×row arithmetic, but the product does not call
that arithmetic the user's invoice. Batch/Flex/Priority, regional uplifts,
subscription/credit conversion, and actual invoice reconciliation remain out
of scope and are named in `docs/cost-model.md`.
