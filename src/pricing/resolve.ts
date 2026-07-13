import type { AgentSource, DirectPricingProvider, PricingUnit, Session, TokenUsage, Turn } from "../parse/types.js";
import { adapterFor } from "../parse/registry.js";
import { addUsage, emptyUsage } from "../parse/util.js";
import { defaultDataDir, loadPriceTable } from "./priceTable.js";
import type { PriceRow, ResolvedPrice, TokenPriceRates } from "./types.js";

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

function isTokenCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * A price is only defensible when the normalized usage is internally valid.
 * Reject malformed transcript data at the shared pricing boundary instead of
 * clamping it: clamping would invent a different token count (I2).
 */
export function isPriceableUsage(usage: TokenUsage): boolean {
  if (
    !isTokenCount(usage.input) ||
    !isTokenCount(usage.output) ||
    !isTokenCount(usage.cacheRead) ||
    !isTokenCount(usage.cacheCreation) ||
    !isTokenCount(usage.total) ||
    (usage.cacheCreation5m !== undefined && !isTokenCount(usage.cacheCreation5m)) ||
    (usage.cacheCreation1h !== undefined && !isTokenCount(usage.cacheCreation1h))
  ) {
    return false;
  }

  const componentTotal = usage.input + usage.output + usage.cacheRead + usage.cacheCreation;
  if (usage.total !== componentTotal) {
    return false;
  }

  const cacheTierTotal = (usage.cacheCreation5m ?? 0) + (usage.cacheCreation1h ?? 0);
  return cacheTierTotal <= usage.cacheCreation;
}

/**
 * Select the highest matching context tier for the full request. The official
 * long-context threshold is prompt-side, so output tokens are intentionally
 * excluded from the selector.
 */
function ratesForUsage(usage: TokenUsage, row: PriceRow): TokenPriceRates {
  const promptInput = usage.input + usage.cacheRead + usage.cacheCreation;
  let selected: TokenPriceRates = row;
  let selectedThreshold = -1;
  for (const tier of row.context_tiers ?? []) {
    if (promptInput > tier.above_input_tokens && tier.above_input_tokens > selectedThreshold) {
      selected = tier;
      selectedThreshold = tier.above_input_tokens;
    }
  }
  return selected;
}

/**
 * Cache-write portion of `costOf`: prices whatever tier breakdown `usage`
 * actually has, rather than assuming one tier for the whole total.
 *
 * When `usage.cacheCreation5m`/`cacheCreation1h` are present (newer Claude
 * Code transcripts split the write by ephemeral TTL), each is priced at its
 * own cited rate. A generic `input_cache_write` rate applies next when the
 * vendor publishes one rate for every write. With no cited applicable rate,
 * that observed component contributes zero to the floor (I2).
 *
 * Any part of `cacheCreation` not covered by a known tier is priced under the
 * documented assumption that it is 5-minute-tier — Claude Code's default
 * cache TTL — at `input_cache_write_5m ?? input_cache_write ?? 0`. It
 * never falls through to the more expensive 1-hour rate for an unsplit write.
 */
function cacheWriteCost(usage: TokenUsage, rates: TokenPriceRates): number {
  const known5m = usage.cacheCreation5m ?? 0;
  const known1h = usage.cacheCreation1h ?? 0;
  const unsplit = usage.cacheCreation - known5m - known1h;
  // TTL-specific citations are the most precise evidence. A generic published
  // write rate is the next-best match and applies to every TTL/unsplit bucket.
  const write5mRate = rates.input_cache_write_5m ?? rates.input_cache_write ?? 0;
  const write1hRate = rates.input_cache_write_1h ?? rates.input_cache_write ?? 0;
  return rate(write5mRate, known5m) + rate(write1hRate, known1h) + rate(write5mRate, unsplit);
}

/**
 * SPEC-0044 A3 — true when `cacheWriteCost` excludes cache-write tokens
 * because `row` doesn't cite the applicable specific or generic rate. This
 * records one additional reason the resulting floor may be low.
 *
 * This is deliberately row-aware, not usage-only: an unsplit (or partially
 * split) write is priced at the *5m* rate by `cacheWriteCost`'s documented
 * assumption, so it is excluded only when `row.input_cache_write_5m` is
 * itself uncited. A vendor that cites the 5m rate (e.g. Anthropic) prices an
 * unsplit write at that cited rate — no cache-tier caveat — even though the transcript never split
 * it. A cited generic write rate covers both TTL buckets and the unsplit
 * remainder. The check uses the same context tier as `costOf`.
 */
export function cacheWriteIsLowerBound(usage: TokenUsage, row: PriceRow): boolean {
  const rates = ratesForUsage(usage, row);
  const known5m = usage.cacheCreation5m ?? 0;
  const known1h = usage.cacheCreation1h ?? 0;
  const unsplit = usage.cacheCreation - known5m - known1h;
  const fallback5mTokens = unsplit + known5m;
  const fallback5mTaken =
    fallback5mTokens > 0 &&
    rates.input_cache_write_5m === undefined &&
    rates.input_cache_write === undefined;
  const fallback1hTaken =
    known1h > 0 &&
    rates.input_cache_write_1h === undefined &&
    rates.input_cache_write === undefined;
  return fallback5mTaken || fallback1hTaken;
}

/** True when observed cached-read tokens have no cited rate in their selected request tier. */
export function cacheReadIsLowerBound(usage: TokenUsage, row: PriceRow): boolean {
  return usage.cacheRead > 0 && ratesForUsage(usage, row).input_cached === undefined;
}

/**
 * Extra amount the observed cached reads would have contributed at the cited
 * plain-input rate. `null` means the selected request tier has no cached-read
 * rate, so even this comparison would require a guess.
 */
export function cacheReadAtInputRateDelta(usage: TokenUsage, row: PriceRow): number | null {
  if (usage.cacheRead === 0) {
    return 0;
  }
  const rates = ratesForUsage(usage, row);
  if (rates.input_cached === undefined || rates.input_cached > rates.input) {
    return null;
  }
  return rate(rates.input - rates.input_cached, usage.cacheRead);
}

/**
 * Deterministic lower-bound arithmetic for `usage` at `row`'s Standard rates.
 *
 * Before pricing, the highest context tier whose threshold is strictly below
 * `input + cacheRead + cacheCreation` is selected for the full request.
 * Cached-read tokens use `input_cached` only when the selected rates cite one;
 * otherwise that component contributes zero to the observable floor. An
 * uncited fallback rate could overstate the floor and would violate I2.
 *
 * Cache-write tokens (`cacheCreation`) are priced by `cacheWriteCost`: known
 * 5-minute/1-hour tier tokens at their own cited rate, and any unsplit
 * remainder under the documented assumption that it's 5-minute-tier —
 * Claude Code's default cache TTL. A generic `input_cache_write` rate applies
 * before the zero-dollar safe stop. If no write rate is cited, writes
 * contribute zero — never a guessed rate (I2). See `cacheWriteCost`.
 */
export function costOf(usage: TokenUsage, row: PriceRow): number {
  const rates = ratesForUsage(usage, row);
  return (
    rate(rates.input, usage.input) +
    rate(rates.output, usage.output) +
    rate(rates.input_cached ?? 0, usage.cacheRead) +
    cacheWriteCost(usage, rates)
  );
}

/**
 * The vendor's cheapest still-current (`to_date: null`) row, by `input`
 * rate. Used by the R4b trivial-span detector and R5's price-delta
 * footnote — both compare one Standard-rate floor against the vendor's
 * cheapest current Standard-rate floor for the same tokens,
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
 * Vendor id for a given adapter source — the adapter's own registry row
 * (SPEC-0028: per-agent facts live on the adapter, not in shared switches).
 * Multi-vendor agents (Cursor, OpenCode) register no vendor and resolve to
 * `undefined` rather than a guessed one.
 */
export function vendorForSource(source: AgentSource): string | undefined {
  return adapterFor(source)?.vendor;
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

/**
 * Vendor id for one concrete turn. Explicit provider evidence wins: a direct
 * vendor pins that table, while `null` means a routed/custom provider and blocks
 * dollar pricing. Only absent evidence (`undefined`) keeps the legacy model-id
 * then source fallback, preserving older transcripts.
 */
export function vendorForTurn(
  source: AgentSource,
  modelId: string | undefined,
  pricingProvider?: DirectPricingProvider | null,
): string | undefined {
  if (pricingProvider === null) {
    return undefined;
  }
  if (pricingProvider !== undefined) {
    return pricingProvider;
  }
  return (modelId ? vendorForModel(modelId) : undefined) ?? vendorForSource(source);
}

/** `YYYY-MM-DD` for an epoch-milliseconds timestamp, or `undefined` if absent. */
export function isoDateOf(epochMs: number | undefined): string | undefined {
  return epochMs === undefined ? undefined : new Date(epochMs).toISOString().slice(0, 10);
}

function sameUsageComponents(a: TokenUsage, b: TokenUsage): boolean {
  return (
    a.input === b.input &&
    a.output === b.output &&
    a.cacheRead === b.cacheRead &&
    a.cacheCreation === b.cacheCreation &&
    a.cacheCreation5m === b.cacheCreation5m &&
    a.cacheCreation1h === b.cacheCreation1h &&
    a.total === b.total
  );
}

/**
 * Return the request-granular evidence for a turn only when it reconciles
 * exactly to the turn envelope. Invalid or empty evidence is a safe stop: a
 * caller must not fall back to aggregate context-tier selection and risk
 * overstating a lower bound.
 */
export function pricingUnitsForTurn(turn: Turn): readonly PricingUnit[] | null {
  if (!turn.usage || !isPriceableUsage(turn.usage)) {
    return null;
  }
  if (turn.pricingUnits === undefined) {
    return [{
      usage: turn.usage,
      timestamp: turn.timestamp,
      model: turn.model,
      pricingProvider: turn.pricingProvider,
    }];
  }
  if (turn.pricingUnits.length === 0 || turn.pricingUnits.some((unit) => !isPriceableUsage(unit.usage))) {
    return null;
  }
  const summed = turn.pricingUnits.reduce((total, unit) => addUsage(total, unit.usage), emptyUsage());
  return sameUsageComponents(summed, turn.usage) ? turn.pricingUnits : null;
}

/** Price a turn at one row while preserving any request-level tier boundaries. */
export function costTurnAtRow(turn: Turn, row: PriceRow): number | null {
  const units = pricingUnitsForTurn(turn);
  if (!units) {
    return null;
  }
  const usd = units.reduce((sum, unit) => sum + costOf(unit.usage, row), 0);
  return Number.isFinite(usd) && usd >= 0 ? usd : null;
}

/**
 * Shared low-level "price one turn" helper used by both `attribution.ts`
 * (R3) and `waste.ts` (R4a/R4b): guards every missing input to `null`
 * rather than throwing, then resolves + costs the turn's usage.
 *
 * Also carries `cacheWriteLowerBound` (SPEC-0044 A3) alongside the priced
 * `usd` figure — computed here, where the resolved `row` is in scope, so
 * callers never have to re-resolve the price row themselves just to check
 * whether the cache-write portion fell back to an uncited rate.
 */
export async function priceTurn(
  vendor: string | undefined,
  modelId: string | undefined,
  dateISO: string | undefined,
  usage: TokenUsage | undefined,
  dataDir: string,
): Promise<{
  usd: number;
  cacheWriteLowerBound: boolean;
  cacheReadLowerBound: boolean;
  cacheReadAtInputRateUsd: number | null;
} | null> {
  if (!vendor || !modelId || !dateISO || !usage || !isPriceableUsage(usage)) {
    return null;
  }
  const row = await resolvePrice(vendor, modelId, dateISO, dataDir);
  if (!row) {
    return null;
  }
  const usd = costOf(usage, row);
  if (!Number.isFinite(usd) || usd < 0) {
    return null;
  }
  return {
    usd,
    cacheWriteLowerBound: cacheWriteIsLowerBound(usage, row),
    cacheReadLowerBound: cacheReadIsLowerBound(usage, row),
    cacheReadAtInputRateUsd: cacheReadAtInputRateDelta(usage, row),
  };
}

export interface PricedSessionTurn {
  usd: number;
  /** Exact request-unit usage excluded from `usd`; zero means the whole turn priced. */
  unpricedUsage: TokenUsage;
  cacheRateLowerBound: boolean;
  cacheReadAtInputRateUsd: number | null;
  byModelUsd: Array<{ model: string; usd: number }>;
}

/**
 * Price one user-facing turn from its request-granular trace evidence. Codex
 * can execute many model requests inside one tool-loop turn; each request
 * selects its own context tier. Unit model/provider/time evidence overrides
 * the enclosing turn only when it was actually persisted.
 */
export async function priceSessionTurn(
  session: Pick<Session, "source" | "model" | "startedAt" | "unpriceable">,
  turn: Turn,
  dataDir: string,
): Promise<PricedSessionTurn | null> {
  const units = pricingUnitsForTurn(turn);
  if (!units) {
    return null;
  }

  let usd = 0;
  let cacheRateLowerBound = false;
  let cacheReadAtInputRateUsd = 0;
  let cacheReadCounterfactualComplete = true;
  let unpricedUsage = emptyUsage();
  let pricedUnitCount = 0;
  const byModel = new Map<string, number>();

  for (const unit of units) {
    const model = unit.model;
    const provider = unit.pricingProvider;
    const dateISO = isoDateOf(unit.timestamp);
    if (!model || !dateISO) {
      unpricedUsage = addUsage(unpricedUsage, unit.usage);
      cacheReadCounterfactualComplete = false;
      continue;
    }
    const vendor = session.unpriceable ? undefined : vendorForTurn(session.source, model, provider);
    const priced = await priceTurn(vendor, model, dateISO, unit.usage, dataDir);
    if (!priced) {
      unpricedUsage = addUsage(unpricedUsage, unit.usage);
      cacheReadCounterfactualComplete = false;
      continue;
    }
    pricedUnitCount++;
    usd += priced.usd;
    cacheRateLowerBound ||= priced.cacheWriteLowerBound || priced.cacheReadLowerBound;
    if (unit.usage.cacheRead > 0) {
      if (priced.cacheReadAtInputRateUsd === null) {
        cacheReadCounterfactualComplete = false;
      } else {
        cacheReadAtInputRateUsd += priced.cacheReadAtInputRateUsd;
      }
    }
    byModel.set(model, (byModel.get(model) ?? 0) + priced.usd);
  }

  if (pricedUnitCount === 0 || !Number.isFinite(usd) || usd < 0) {
    return null;
  }
  return {
    usd,
    unpricedUsage,
    cacheRateLowerBound,
    cacheReadAtInputRateUsd: cacheReadCounterfactualComplete ? cacheReadAtInputRateUsd : null,
    byModelUsd: [...byModel.entries()].map(([model, modelUsd]) => ({ model, usd: modelUsd })),
  };
}
