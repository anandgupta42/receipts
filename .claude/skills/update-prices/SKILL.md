---
name: update-prices
description: "Refresh a model vendor's price table in data/prices/ with cited sources. This is the daily price-freshness loop body — use when the user asks to update prices, check for price changes, or refresh a vendor's rates."
trigger: /update-prices
---

# /update-prices — one cited PR per vendor

## Rule zero

Every price-row change needs a `sources:` entry with a URL you actually fetched and
read. **Never invent or infer a price.** The `block-price-edit-without-citation` hook
enforces this mechanically (exit 2 on a `data/prices/**` edit with no `sources` in the
diff) — this skill exists to make sure you clear that bar honestly, not to work around
it.

## 1. Scope: one vendor per PR

Pick a single vendor's price page (the vendor's own pricing page or API pricing docs —
not a third-party aggregator, which can be stale). Fetch it. Read `data/prices/README.md`
for the exact schema (`price_history` rows: `input, output, input_cached, from_date,
to_date, sources[]`).

## 2. Diff, don't overwrite

- If a price changed: **close out** the old `price_history` row by setting its `to_date`
  to the day before the new rate took effect, then **append** a new row with the new
  rate and `from_date` — never edit a historical row's numbers. Old sessions must still
  price at the rate that was live when they ran (I3).
- If a price is unchanged, no edit needed — don't touch the file just to bump a
  timestamp.

## 3. Cite precisely

Each `sources` entry is the exact URL of the page that states the price, not the
vendor's homepage. If the page requires interpretation (e.g. a tiered rate), quote the
relevant line in the PR description so a human reviewer doesn't have to re-derive it.

## 4. Verify before opening the PR

Run `node scripts/cite-check.ts` (verifies cited URLs resolve and the claimed price
appears on the page) and the unmasked verification block. Both must pass.

## 5. PR

Title: `chore(prices): update <vendor> rates`. Body: what changed, the cited URL(s), and
the effective date. One vendor per PR keeps review fast and the diff auditable.
