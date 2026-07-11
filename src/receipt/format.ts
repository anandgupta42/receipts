// Locale-independent formatting primitives for the receipt (R5: byte-stable
// output — no `toLocaleString`/`Intl`, which vary by runtime locale/ICU data
// and would break golden tests across CI runners). `toISOString()` and
// `Number.prototype.toFixed()` are safe (fixed format regardless of locale)
// and are used directly where noted.

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Fixed `Mon DD YYYY HH:MM:SS UTC` — absolute timestamps only (no relative "3h ago" wording), fixed to UTC regardless of session/runtime TZ. */
export function formatAbsoluteUtc(epochMs: number): string {
  const d = new Date(epochMs);
  return `${MONTH_ABBR[d.getUTCMonth()]} ${pad2(d.getUTCDate())} ${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC`;
}

/** Fixed `Mon DD YYYY` UTC date — for digests/windows that report a day, not an instant (no time-of-day, no locale). */
export function formatDateUtc(epochMs: number): string {
  const d = new Date(epochMs);
  return `${MONTH_ABBR[d.getUTCMonth()]} ${pad2(d.getUTCDate())} ${d.getUTCFullYear()}`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${h}h ${pad2(m)}m ${pad2(s)}s`;
  }
  if (m > 0) {
    return `${m}m ${pad2(s)}s`;
  }
  return `${s}s`;
}

/** Thousands-grouped integer string with a fixed `,` separator (never a locale-dependent grouping character). */
export function commaGroup(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(n));
  const str = String(abs);
  const groups: string[] = [];
  for (let i = str.length; i > 0; i -= 3) {
    groups.unshift(str.slice(Math.max(0, i - 3), i));
  }
  return sign + groups.join(",");
}

export function formatInt(n: number): string {
  return commaGroup(Math.round(n));
}

/**
 * Round a 0..1 share without turning a real minority into `0%` or a real mix
 * into `100%`. Exact endpoints keep their exact labels.
 */
export function formatSharePercent(share: number): string {
  const pct = Math.round(share * 100);
  if (pct <= 0 && share > 0) {
    return "<1%";
  }
  if (pct >= 100 && share < 1) {
    return ">99%";
  }
  return `${pct}%`;
}

/** `$`-free comma-grouped dollar amount (e.g. `"1,234.56"`) — callers prepend `$`; keeps zero-`$`-bytes callers (tokens-only mode) from having to strip a symbol back out. */
export function formatUsd(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const cents = Math.round(abs * 100);
  const dollars = Math.floor(cents / 100);
  const rem = cents % 100;
  return `${sign}${commaGroup(dollars)}.${pad2(rem)}`;
}

/**
 * `$`-free, downward-rounded amount for a nonnegative lower-bound claim.
 * Cents are used normally; sub-cent values retain four decimals so a real
 * observable component does not collapse to a useless zero. Unlike
 * `formatUsd`, this function never rounds a claim above its input.
 */
export type UsdFloorDecimals = 2 | 4;

/** One downward precision for an additive display ledger. */
export function usdFloorDecimals(values: Iterable<number | null | undefined>): UsdFloorDecimals {
  for (const value of values) {
    if (value !== null && value !== undefined && value > 0) {
      const nearestCent = Math.round(value * 100) / 100;
      const tolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * 8;
      // A tiny positive sum residue such as 0.1 + 0.2 may safely render at
      // the lower exact cent. A value microscopically below the cent cannot:
      // keep four decimals rather than rounding a `≥` claim upward.
      if (nearestCent > value || Math.abs(nearestCent - value) > tolerance) {
        return 4;
      }
    }
  }
  return 2;
}

function floorUsdUnits(n: number, decimals: UsdFloorDecimals): number {
  const safe = Number.isFinite(n) && n > 0 ? n : 0;
  const scale = 10 ** decimals;
  const scaled = safe * scale;
  let units = Math.floor(scaled);
  const nearest = Math.round(scaled);
  if (nearest / scale <= safe) {
    units = nearest;
  }
  // Multiplication can round the float immediately below a decimal boundary
  // up to that boundary (for example nextDown(0.10) * 100 === 10). Correct
  // the candidate against the original value so a displayed `≥` amount can
  // never exceed the numeric lower bound it represents.
  if (units > 0 && units / scale > safe) {
    units--;
  }
  return units;
}

function formatUsdUnits(units: number, decimals: UsdFloorDecimals): string {
  const scale = 10 ** decimals;
  const dollars = Math.floor(units / scale);
  const remainder = String(units % scale).padStart(decimals, "0");
  return `${commaGroup(dollars)}.${remainder}`;
}

export function formatUsdFloor(n: number, precision?: UsdFloorDecimals): string {
  const safe = Number.isFinite(n) && n > 0 ? n : 0;
  const decimals = precision ?? usdFloorDecimals([safe]);
  return formatUsdUnits(floorUsdUnits(safe, decimals), decimals);
}

/** Human-facing cost claim: observable tokens at the cited global Standard API list price. It is a floor, never an invoice. */
export function formatUsdLowerBound(n: number, precision?: UsdFloorDecimals): string {
  return `≥ $${formatUsdFloor(n, precision)}`;
}

/** Compact form for status lines where an extra separator column is expensive. */
export function formatUsdLowerBoundCompact(n: number, precision?: UsdFloorDecimals): string {
  return `≥$${formatUsdFloor(n, precision)}`;
}

export const STANDARD_API_LOWER_BOUND_NOTE = "standard API-equivalent floor; not an invoice";

/** `label` left-aligned, `value` right-aligned, `.` leaders filling the gap — the till-receipt line style. Falls back to a single-space gap if `label`+`value` already meet/exceed `width`. */
export const MIN_LEADER = 3;

/** Fixed-grid row: label left, dotted leader, value flush right. A label too long
 * for the grid is truncated with `…` — the value column NEVER moves (anti-pattern
 * A4: width drift breaks every row below it; long MCP tool names hit this live). */
export function dottedLine(label: string, value: string, width: number): string {
  const maxLabel = width - value.length - MIN_LEADER;
  const l = label.length > maxLabel ? `${label.slice(0, Math.max(1, maxLabel - 1)).trimEnd()}…` : label;
  const dotsLen = Math.max(1, width - l.length - value.length);
  return `${l}${".".repeat(dotsLen)}${value}`;
}

/** Center `text` within `width`, extra padding column going right. Counts Unicode code points (not UTF-16 code units), so a single emoji doesn't get double-counted and thrown off-center. */
export function center(text: string, width: number): string {
  const len = [...text].length;
  if (len >= width) {
    return text;
  }
  const totalPad = width - len;
  const left = Math.floor(totalPad / 2);
  const right = totalPad - left;
  return " ".repeat(left) + text + " ".repeat(right);
}

/** Greedy word-wrap to `width` columns. Splits only on spaces (no hyphenation) — a single word longer than `width` is placed on its own line unbroken rather than mid-word split. */
export function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

/** `N.N×` ratio — `toFixed` is locale-independent (always `.` as the decimal point) so this is safe without the `Intl` ban applying. */
export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(1)}×`;
}

/** `Nk tok` — token count rounded to the nearest thousand, for compact one-line surfaces (statusline R1). Never fabricates precision the caller doesn't have. */
export function formatTokensK(n: number): string {
  return `${formatInt(Math.round(n / 1000))}k tok`;
}

/**
 * SPEC-0026 round 2 / SPEC-0071 R1 — abbreviated token counts for stat lines
 * (`371k`, `1.2M`, `1.5B`). One decimal only while it disambiguates (< 10 of the
 * unit), deterministic rounding; never truncates a digit mid-value. The `B`
 * branch takes over exactly where `M` would otherwise render `1000M`.
 */
export function formatShortTokens(n: number): string {
  if (n < 1000) {
    return String(n);
  }
  const unit = (v: number, suffix: string): string =>
    `${v < 9.95 ? v.toFixed(1).replace(/\.0$/u, "") : String(Math.round(v))}${suffix}`;
  if (n < 999_500) {
    return unit(n / 1000, "k");
  }
  if (n < 999_500_000) {
    return unit(n / 1_000_000, "M");
  }
  return unit(n / 1_000_000_000, "B");
}

/**
 * B1 fix — largest-remainder apportionment (Hamilton's method). Rows and the
 * TOTAL they belong to used to round independently (each row through
 * `formatUsd`, the total over the raw sum), so a receipt could visibly show
 * rows that don't add up to its own total. This splits a raw total's cents
 * across its rows so the DISPLAYED rows always sum to the DISPLAYED total,
 * without changing the total's own value: each amount floors to its own
 * cents first, then the whole cent(s) lost to flooring are handed to the
 * items with the largest fractional cent, one cent each — ties broken by
 * input order, so output stays deterministic (I5). `amounts` are this
 * codebase's dollar costs, always >= 0 in practice; the negative branch below
 * (clawing cents back from the smallest remainders) exists only so a
 * degenerate/adversarial input degrades gracefully instead of crashing.
 */
export function reconcileCents(amounts: number[]): number[] {
  if (amounts.length === 0) {
    return [];
  }
  const rawSum = amounts.reduce((sum, a) => sum + a, 0);
  // Mirrors `formatUsd`'s own rounding exactly (round the magnitude, then sign
  // it) so the total this apportions to is byte-identical to what the TOTAL
  // line already renders — this fix changes row splits, never the total.
  const totalCents = rawSum < 0 ? -Math.round(-rawSum * 100) : Math.round(rawSum * 100);
  const rawCents = amounts.map((a) => a * 100);
  const floors = rawCents.map((c) => Math.floor(c));
  const remainders = rawCents.map((c, i) => c - floors[i]);
  const leftover = totalCents - floors.reduce((sum, c) => sum + c, 0);

  const cents = [...floors];
  const order = amounts.map((_, i) => i);
  if (leftover >= 0) {
    order.sort((a, b) => remainders[b] - remainders[a] || a - b);
    for (let i = 0; i < leftover; i++) {
      cents[order[i]] += 1;
    }
  } else {
    order.sort((a, b) => remainders[a] - remainders[b] || a - b);
    for (let i = 0; i < -leftover; i++) {
      cents[order[i]] -= 1;
    }
  }
  return cents;
}

/** An exact integer cent amount (e.g. from {@link reconcileCents}) as a `formatUsd`-style string — no rounding left to do, the split already landed on whole cents. */
export function formatCentsAmount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${commaGroup(Math.floor(abs / 100))}.${pad2(abs % 100)}`;
}
