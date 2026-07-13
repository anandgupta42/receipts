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

/** Token rates in USD per million tokens. */
export interface TokenPriceRates {
  input: number;
  output: number;
  input_cached?: number;
  /** Vendor-published cache-write rate when writes have no TTL-specific price. */
  input_cache_write?: number;
  input_cache_write_5m?: number;
  input_cache_write_1h?: number;
}

/**
 * An alternate full-request rate card selected when normalized prompt input is
 * strictly greater than `above_input_tokens`. Prompt input is the sum of plain
 * input, cache reads, and cache creation; output never selects a context tier.
 *
 * Rates are deliberately complete rather than inherited from the base row. An
 * omitted optional rate therefore keeps the existing conservative fallback to
 * this tier's `input` rate instead of silently borrowing a discount from a
 * different context tier (I2).
 */
export interface ContextPriceTier extends TokenPriceRates {
  above_input_tokens: number;
}

/**
 * One dated price row. `to_date: null` means "still current"; rows must be
 * contiguous, non-overlapping windows ordered by `from_date` (enforced by
 * `test/pricing/price-tables.test.ts`, not by this module).
 */
export interface PriceRow extends TokenPriceRates {
  context_tiers?: ContextPriceTier[];
  from_date: string;
  to_date: string | null;
  sources: PriceSource[];
}

/**
 * A model deliberately left out of `models` because its official page has a
 * pricing dimension the schema cannot hold honestly (priority/batch,
 * tool-priced, regional, or otherwise unsupported). Documented, not priced —
 * so a reviewer sees
 * *why* a well-known model is absent rather than assuming an oversight
 * (SPEC-0005 R1). Never consulted by the resolver: an omitted model has no
 * row, so it stays tokens-only (I2).
 */
export interface OmittedModel {
  model: string;
  reason: string;
  source?: string;
}

export interface PriceTable {
  vendor: string;
  models: Record<string, { price_history: PriceRow[] }>;
  omitted?: OmittedModel[];
}

/** A resolved row plus the vendor/model it was resolved for, so callers never need to re-thread that context. */
export interface ResolvedPrice extends PriceRow {
  vendor: string;
  model: string;
}
