---
id: SPEC-0005
title: "Price-table vendor breadth — Google, DeepSeek (+ xAI if citable)"
status: draft
milestone: M2
depends: [SPEC-0001]
---

# SPEC-0005 · Price-table vendor breadth

Invariants: I2 (no price without a matching dated row), I3 (every row cited).

## Purpose

The compare story ("same task: Sonnet $7 vs DeepSeek $0.40") needs the cheap-model
vendors priced. Extend coverage beyond Anthropic/OpenAI via the update-prices
discipline — one vendor per change, every row cited.

## Requirements

- **R1 — New vendor tables.** `data/prices/google.json`, `data/prices/deepseek.json`,
  and `data/prices/xai.json` **only if** an official pricing page is fetchable and
  unambiguous — otherwise omit the vendor entirely (omit-on-doubt). Real prices from
  official pages, `sources: [{url, observed_at}]` on every row; cache-read pricing
  captured where the vendor publishes it.
- **R2 — Resolution mapping.** Extend the model-id→vendor-table resolution for these
  vendors' current model-id formats (e.g. `gemini-*`, `deepseek-*`). Unknown ids remain
  tokens-only — no family guessing (R2 of SPEC-0001 binds).
- **R3 — Gates.** cite-check + the citation hook apply unchanged; CI `prices` job green;
  a fixture-based resolution test per new vendor.

## Non-goals

Local/open-weight models (no canonical price); aggregators/routers (OpenRouter etc. —
their pricing is plan-dependent; future spec); historical back-fill beyond each page's
currently published rates; auto-refresh scheduling (the daily loop handles it later).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 cited rows | each new vendor json | cite-check green; every row has url+observed_at |
| R2 resolution | fixture turns with gemini-/deepseek- ids | correct table row picked by date |
| R2 unknown id | made-up model id | tokens-only, zero `$` |
| R3 hook | uncited row write attempt | blocked (exit 2) |

## Success criteria

- [ ] ≥2 new vendor tables landed with official citations (xAI optional per R1).
- [ ] `compare` on two fixtures (frontier vs cheap vendor) renders both priced — the
      demo asset feeds SPEC-0004's compare SVG.
- [ ] Unmasked gate + spec-lint + prices CI job green.

## Validation

*(pending /validate-spec)*
