#!/usr/bin/env -S node --experimental-strip-types
// Verifies that every `sources` URL in data/prices/*.json resolves and that the
// claimed price actually appears on the cited page. Used by the update-prices
// skill (I3, AGENTS.md) before opening a price-update PR.
//
// TODO(M1+): implement once data/prices/*.json vendor files exist.
//   - Parse each vendor JSON's price_history[].sources[] URLs.
//   - Fetch each URL, confirm HTTP 200.
//   - Heuristically confirm the row's input/output rate appears in the fetched
//     page text (best-effort; flag for human review rather than hard-fail on a
//     miss, since pricing pages are unstructured prose/tables).
//   - Exit non-zero if any cited URL is unreachable.

interface PriceRow {
  input: number;
  output: number;
  input_cached?: number;
  from_date: string;
  to_date?: string;
  sources: string[];
}

interface VendorPriceTable {
  vendor: string;
  models: Record<string, { price_history: PriceRow[] }>;
}

async function main(): Promise<void> {
  console.log("cite-check: no price tables exist yet (Tier 0 harness) — nothing to check.");
  process.exit(0);
}

void main();
