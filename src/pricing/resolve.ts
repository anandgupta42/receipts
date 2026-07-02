import type { AgentSource, TokenUsage } from "../parse/types.js";
import { defaultDataDir, loadPriceTable } from "./priceTable.js";
import type { PriceRow, ResolvedPrice } from "./types.js";

/**
 * Resolve the dated price row for `modelId` on `dateISO` (an ISO `YYYY-MM-DD`
 * date). Returns `null` — never a guessed or nearest-neighbor price — when
 * the vendor/model/date has no matching cited row (I2: never fabricate a
 * dollar). No family-guessing, no default tier: an unknown model id is
 * unpriced, full stop.
 *
 * Date windows are inclusive on both ends (`from_date <= dateISO <= to_date`,
 * or `to_date === null` for a still-current row) and compared as ISO strings
 * — lexicographic string comparison on `YYYY-MM-DD` is date-order-preserving
 * and needs no `Date` parsing (I1: deterministic).
 */
export async function resolvePrice(
  vendor: string,
  modelId: string,
  dateISO: string,
  dataDir: string = defaultDataDir(),
): Promise<ResolvedPrice | null> {
  const table = await loadPriceTable(vendor, dataDir);
  const history = table?.models[modelId]?.price_history;
  if (!history) {
    return null;
  }
  const row = history.find((r) => r.from_date <= dateISO && (r.to_date === null || dateISO <= r.to_date));
  return row ? { ...row, vendor, model: modelId } : null;
}

function rate(perMillion: number, tokens: number): number {
  return (tokens / 1_000_000) * perMillion;
}

/**
 * Dollar cost of `usage` at `row`'s rates.
 *
 * Cached-read tokens use `input_cached` when the row cites one, otherwise
 * the plain `input` rate — a conservative fallback (never under-charges)
 * rather than inventing an uncited discount (I2).
 *
 * Cache-write tokens (`cacheCreation`) use `input_cache_write_5m` when the
 * row cites one — Claude Code's default cache TTL is 5 minutes, so that's
 * the rate a write is billed at unless the caller opted into the 1-hour
 * cache — else `input_cache_write_1h` when only that's cited, else the base
 * `input` rate. No transcript we parse records which TTL tier a given write
 * used, so this is a documented default-tier choice, not a guess at the
 * actual tier; the base-input fallback (when the row cites neither field)
 * mirrors the cached-read fallback above and likewise never under-charges,
 * since Anthropic always bills a cache write at a multiple of the input
 * rate (I2).
 */
export function costOf(usage: TokenUsage, row: PriceRow): number {
  return (
    rate(row.input, usage.input) +
    rate(row.output, usage.output) +
    rate(row.input_cached ?? row.input, usage.cacheRead) +
    rate(row.input_cache_write_5m ?? row.input_cache_write_1h ?? row.input, usage.cacheCreation)
  );
}

/**
 * The vendor's cheapest still-current (`to_date: null`) row, by `input`
 * rate. Used by the R4b trivial-span detector and R5's price-delta
 * footnote — both compare "what this turn actually cost" against "what the
 * vendor's cheapest current model would have cost for the same tokens",
 * never against a specific named competitor or a whole-session prediction.
 */
export async function cheapestCurrentRow(
  vendor: string,
  dataDir: string = defaultDataDir(),
): Promise<{ model: string; row: PriceRow } | null> {
  const table = await loadPriceTable(vendor, dataDir);
  if (!table) {
    return null;
  }
  let best: { model: string; row: PriceRow } | null = null;
  for (const [model, entry] of Object.entries(table.models)) {
    const current = entry.price_history.find((r) => r.to_date === null);
    if (current && (!best || current.input < best.row.input)) {
      best = { model, row: current };
    }
  }
  return best;
}

/**
 * Vendor id for a given adapter source. Cursor sessions never resolve a
 * price (R1: `unpriceable`, no per-turn model id or usage), so it maps to
 * `undefined` rather than a guessed vendor.
 */
export function vendorForSource(source: AgentSource): string | undefined {
  switch (source) {
    case "claude-code":
      return "anthropic";
    case "codex":
      return "openai";
    case "cursor":
      return undefined;
  }
}

/** `YYYY-MM-DD` for an epoch-milliseconds timestamp, or `undefined` if absent. */
export function isoDateOf(epochMs: number | undefined): string | undefined {
  return epochMs === undefined ? undefined : new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Shared low-level "price one turn" helper used by both `attribution.ts`
 * (R3) and `waste.ts` (R4a/R4b): guards every missing input to `null`
 * rather than throwing, then resolves + costs the turn's usage.
 */
export async function priceTurn(
  vendor: string | undefined,
  modelId: string | undefined,
  dateISO: string | undefined,
  usage: TokenUsage | undefined,
  dataDir: string,
): Promise<number | null> {
  if (!vendor || !modelId || !dateISO || !usage) {
    return null;
  }
  const row = await resolvePrice(vendor, modelId, dateISO, dataDir);
  return row ? costOf(usage, row) : null;
}
