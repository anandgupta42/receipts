/**
 * Types for `src/pricing/**` — mirror the on-disk price-table JSON schema
 * (`data/prices/<vendor>.json`) field-for-field so there is no translation
 * layer between the cited source data and the resolver (I3: every number
 * traces straight back to the row and source it came from).
 */

/** A citation for a `PriceRow` — the receipt never prints a `$` that can't be traced here (I3). */
export interface PriceSource {
  url: string;
  observed_at?: string;
  excerpt?: string;
}

/**
 * One dated price row. Rates are USD per million tokens. `to_date: null`
 * means "still current"; a table's rows must be contiguous, non-overlapping
 * windows ordered by `from_date` (enforced by `test/pricing/price-tables.test.ts`,
 * not by this module).
 */
export interface PriceRow {
  input: number;
  output: number;
  input_cached?: number;
  input_cache_write_5m?: number;
  input_cache_write_1h?: number;
  from_date: string;
  to_date: string | null;
  sources: PriceSource[];
}

export interface PriceTable {
  vendor: string;
  models: Record<string, { price_history: PriceRow[] }>;
}

/** A resolved row plus the vendor/model it was resolved for, so callers never need to re-thread that context. */
export interface ResolvedPrice extends PriceRow {
  vendor: string;
  model: string;
}
