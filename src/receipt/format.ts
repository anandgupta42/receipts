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
function commaGroupDigits(digits: string): string {
  const groups: string[] = [];
  for (let i = digits.length; i > 0; i -= 3) {
    groups.unshift(digits.slice(Math.max(0, i - 3), i));
  }
  return groups.join(",");
}

export function commaGroup(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(n));
  return sign + commaGroupDigits(String(abs));
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
 * Cents are used normally; precision adapts through 12 decimals when needed.
 * Unlike `formatUsd`, this function never rounds a claim above the canonical
 * decimal Number value emitted to machine consumers.
 */
export type UsdFloorDecimals = 2 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

const MAX_USD_FLOOR_DECIMALS: UsdFloorDecimals = 12;

/** One downward precision for an additive display ledger. */
export function usdFloorDecimals(values: Iterable<number | null | undefined>): UsdFloorDecimals {
  const observed = [...values];
  let decimals: UsdFloorDecimals = 2;
  for (const value of observed) {
    if (value !== null && value !== undefined && value > 0) {
      // Above MAX_SAFE_INTEGER a Number cannot represent fractional dollars,
      // so multiplying by 100 only risks Infinity and cannot reveal cents.
      if (value <= Number.MAX_SAFE_INTEGER) {
        const nearestCent = Math.round(value * 100) / 100;
        const tolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * 8;
        // A tiny positive sum residue such as 0.1 + 0.2 may safely render at
        // the lower exact cent. A value microscopically below the cent cannot:
        // keep four decimals rather than rounding a `≥` claim upward.
        if (nearestCent > value || Math.abs(nearestCent - value) > tolerance) {
          decimals = Math.max(decimals, 4) as UsdFloorDecimals;
        }
      }
      // Four decimals are normally enough, but a positive observable floor
      // below $0.0001 should not collapse to zero when it is representable
      // within this format's deterministic 12-decimal observability cap.
      // Increase only until its first safely displayable decimal unit survives.
      while (decimals < MAX_USD_FLOOR_DECIMALS && floorUsdUnits(value, decimals) === 0n) {
        decimals = (decimals + 1) as UsdFloorDecimals;
      }
    }
  }
  return decimals;
}

/**
 * Floor the canonical decimal value a machine consumer sees (`Number#toString`
 * is also JSON's finite-number spelling) into exact integer display units.
 * BigInt avoids both unsafe-integer corruption for huge amounts and binary
 * multiplication crossing a decimal boundary.
 */
function floorUsdUnits(n: number, decimals: UsdFloorDecimals): bigint {
  const safe = Number.isFinite(n) && n > 0 ? n : 0;
  if (safe === 0) {
    return 0n;
  }

  const [coefficient, exponentText] = safe.toString().toLowerCase().split("e");
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const [whole, fraction = ""] = coefficient.split(".");
  const digitsText = `${whole}${fraction}`.replace(/^0+/u, "") || "0";
  const decimalPlaces = fraction.length - exponent;
  const shift = decimals - decimalPlaces;
  const digits = BigInt(digitsText);
  if (shift >= 0) {
    return digits * (10n ** BigInt(shift));
  }
  return digits / (10n ** BigInt(-shift));
}

function formatUsdUnits(units: bigint, decimals: UsdFloorDecimals): string {
  const scale = 10n ** BigInt(decimals);
  const dollars = units / scale;
  const remainder = (units % scale).toString().padStart(decimals, "0");
  return `${commaGroupDigits(dollars.toString())}.${remainder}`;
}

export function formatUsdFloor(n: number, precision?: UsdFloorDecimals): string {
  const safe = Number.isFinite(n) && n > 0 ? n : 0;
  const decimals = precision ?? usdFloorDecimals([safe]);
  return formatUsdUnits(floorUsdUnits(safe, decimals), decimals);
}

export interface UsdFloorLedger {
  precision: UsdFloorDecimals;
  amounts: string[];
  total: string;
}

/**
 * One additive display ledger. Every row starts at its independent floor at
 * one shared precision. When `rawTotal` is supplied and their exact unit sum
 * would exceed it, excess units are removed from the largest rows. TOTAL remains
 * the exact sum of the displayed rows and never exceeds that public aggregate.
 * Callers without a displayed/machine aggregate may omit `rawTotal`; their rows
 * remain independent floors and `total` is simply their exact displayed sum.
 */
export function formatUsdFloorLedger(
  values: readonly number[],
  precision?: UsdFloorDecimals,
  rawTotal?: number,
): UsdFloorLedger {
  const normalized = values.map((value) => Number.isFinite(value) && value > 0 ? value : 0);
  const aggregate = rawTotal === undefined
    ? undefined
    : Number.isFinite(rawTotal) && rawTotal > 0
      ? rawTotal
      : 0;
  const safePrecision = precision ?? usdFloorDecimals([
    ...normalized,
    ...(aggregate === undefined ? [] : [aggregate]),
  ]);
  const units = normalized.map((value) => floorUsdUnits(value, safePrecision));

  // IEEE-754 addition can serialize just below the mathematical sum of the
  // rows (0.1 + 0.7 -> 0.7999999999999999). The raw aggregate is the public
  // machine scalar, so the text floor must not exceed its downward decimal
  // floor. Remove any excess from the largest displayed rows; this only makes
  // a component more conservative and preserves tiny positive evidence.
  let totalUnits = units.reduce((sum, value) => sum + value, 0n);
  let excess = aggregate === undefined ? 0n : totalUnits - floorUsdUnits(aggregate, safePrecision);
  if (excess > 0n) {
    const order = units
      .map((value, index) => ({ index, value }))
      .sort((a, b) => a.value === b.value ? a.index - b.index : a.value > b.value ? -1 : 1);
    for (const { index } of order) {
      if (excess === 0n) {
        break;
      }
      const removed = units[index] < excess ? units[index] : excess;
      units[index] -= removed;
      excess -= removed;
    }
    totalUnits = units.reduce((sum, value) => sum + value, 0n);
  }
  return {
    precision: safePrecision,
    amounts: units.map((value) => formatUsdUnits(value, safePrecision)),
    total: formatUsdUnits(totalUnits, safePrecision),
  };
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
