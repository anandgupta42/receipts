# data/prices — cited price tables

One JSON file per vendor (e.g. `anthropic.json`, `openai.json`). Schema is a TypeScript
port of [simonw/llm-prices](https://github.com/simonw/llm-prices)'s `price_history`
model: every rate change is a new row, not an overwrite, so a session is always priced
at the rate that was live on the day it ran (I3, `AGENTS.md`).

## Schema

```json
{
  "vendor": "anthropic",
  "models": {
    "claude-fable-5": {
      "price_history": [
        {
          "input": 3.0,
          "output": 15.0,
          "input_cached": 0.3,
          "input_cache_write_5m": 3.75,
          "input_cache_write_1h": 6.0,
          "from_date": "2026-05-01",
          "to_date": null,
          "sources": [{ "url": "https://www.anthropic.com/pricing", "observed_at": "2026-07-01" }]
        }
      ]
    }
  }
}
```

- `input` / `output` — USD per million tokens.
- `input_cached` — USD per million cached-input (cache-read) tokens, if the vendor
  prices it separately; omit the field if not applicable (never guess a value).
- `input_cache_write_5m` / `input_cache_write_1h` — USD per million tokens for writing
  to the prompt cache at the vendor's 5-minute / 1-hour TTL tiers, if the vendor prices
  cache writes separately from cache reads; omit either or both fields if the vendor
  doesn't publish that tier (never guess a value).
- `from_date` / `to_date` — ISO date the rate took effect / was superseded. `to_date:
  null` means the row is currently active.
- `sources` — **required**, non-empty array of objects, each with a `url` (http/https) actually fetched and read, plus optional `observed_at` (YYYY-MM-DD) and `excerpt`. This is
  the field the `block-price-edit-without-citation` hook checks for; a PR that touches
  this directory without a `sources` array is rejected mechanically before it ever
  reaches review.

## Rule

**Every row change needs a cited source URL.** No price is ever invented, inferred, or
carried over from memory. Closing out a stale row (setting its `to_date`) and appending
a new one is the only way to change a rate — historical rows are never edited in place.

## No price files are seeded yet

This directory intentionally ships empty of vendor data (Tier 0 — harness only). Real
price tables land via the `update-prices` skill, one vendor per PR, each with a real
cited source. Do not hand-write a vendor JSON with placeholder or remembered numbers to
"get started" — that violates I2 (never fabricate a dollar) on day one.
