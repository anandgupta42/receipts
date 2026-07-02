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
 * Cache-write portion of `costOf`: prices whatever tier breakdown `usage`
 * actually has, rather than assuming one tier for the whole total.
 *
 * When `usage.cacheCreation5m`/`cacheCreation1h` are present (newer Claude
 * Code transcripts split the write by ephemeral TTL), each priced at its own
 * cited rate — `input_cache_write_5m ?? input` / `input_cache_write_1h ??
 * input` — a conservative fallback to the base input rate when the row
 * doesn't cite that tier. Cache-write billing runs at a premium over base
 * input (typically ≥1.25×), so this fallback may *understate* the true
 * cost; it never overstates it by inventing an uncited premium (I2).
 *
 * Any part of `cacheCreation` not covered by a known tier (either because
 * the transcript never split it, or a partial split leaves a remainder) is
 * priced under the documented assumption that it's 5-minute-tier — Claude
 * Code's default cache TTL — at `input_cache_write_5m ?? input`. This does
 * *not* fall through to the 1-hour rate for the unsplit remainder: an
 * unsplit write is an assumed 5m write, not an unknown-tier write, so it
 * gets the 5m-or-base fallback chain, never the more expensive 1h rate
 * (I2: never *over*-charge on a guess either — state the assumption instead).
 */
function cacheWriteCost(usage: TokenUsage, row: PriceRow): number {
  const known5m = usage.cacheCreation5m ?? 0;
  const known1h = usage.cacheCreation1h ?? 0;
  const unsplit = usage.cacheCreation - known5m - known1h;
  const write5mRate = row.input_cache_write_5m ?? row.input;
  const write1hRate = row.input_cache_write_1h ?? row.input;
  return rate(write5mRate, known5m) + rate(write1hRate, known1h) + rate(write5mRate, unsplit);
}

/**
 * Dollar cost of `usage` at `row`'s rates.
 *
 * Cached-read tokens use `input_cached` when the row cites one, otherwise
 * the plain `input` rate — a conservative fallback (never under-charges)
 * rather than inventing an uncited discount (I2).
 *
 * Cache-write tokens (`cacheCreation`) are priced by `cacheWriteCost`: known
 * 5-minute/1-hour tier tokens at their own cited rate, and any unsplit
 * remainder under the documented assumption that it's 5-minute-tier —
 * Claude Code's default cache TTL. If a row cites neither cache-write rate,
 * writes fall back to the base `input` rate — this may understate real cost
 * (cache-write billing runs ≥1.25× input) but never overstates it with a
 * guessed premium (I2). See `cacheWriteCost` for the exact fallback chain.
 */
export function costOf(usage: TokenUsage, row: PriceRow): number {
  return (
    rate(row.input, usage.input) +
    rate(row.output, usage.output) +
    rate(row.input_cached ?? row.input, usage.cacheRead) +
    cacheWriteCost(usage, row)
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
    case "gemini":
      // Gemini CLI is single-vendor (Google only); per-turn model ids select
      // the row within google.json. (SPEC-0010 R3.)
      return "google";
    case "cursor":
      return undefined;
  }
}

/**
 * Vendor id for a raw model id, by id-prefix family (R4). Mirrors the vendor
 * whose `data/prices/<vendor>.json` actually holds that family's rows, so a
 * model id resolved here is one `resolvePrice` can price. Unknown prefixes
 * return `undefined` — an unrecognized id stays tokens-only, never guessed to
 * a vendor (I2). Extended one landed vendor per PR (SPEC-0005 R2/R4); a family
 * is added here only alongside its cited price table.
 */
export function vendorForModel(modelId: string): string | undefined {
  if (modelId.startsWith("claude-")) {
    return "anthropic";
  }
  if (modelId.startsWith("gpt-")) {
    return "openai";
  }
  if (modelId.startsWith("gemini-")) {
    return "google";
  }
  if (modelId.startsWith("deepseek-")) {
    return "deepseek";
  }
  return undefined;
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
