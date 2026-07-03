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

/** `$`-free comma-grouped dollar amount (e.g. `"1,234.56"`) — callers prepend `$`; keeps zero-`$`-bytes callers (tokens-only mode) from having to strip a symbol back out. */
export function formatUsd(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const cents = Math.round(abs * 100);
  const dollars = Math.floor(cents / 100);
  const rem = cents % 100;
  return `${sign}${commaGroup(dollars)}.${pad2(rem)}`;
}

/** `label` left-aligned, `value` right-aligned, `.` leaders filling the gap — the till-receipt line style. Falls back to a single-space gap if `label`+`value` already meet/exceed `width`. */
const MIN_LEADER = 3;

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
 * SPEC-0026 round 2 — abbreviated token counts for stat lines (`371k`, `1.2M`).
 * One decimal only while it disambiguates (< 10 of the unit), deterministic
 * rounding; never truncates a digit mid-value.
 */
export function formatShortTokens(n: number): string {
  if (n < 1000) {
    return String(n);
  }
  const unit = (v: number, suffix: string): string =>
    `${v < 9.95 ? v.toFixed(1).replace(/\.0$/u, "") : String(Math.round(v))}${suffix}`;
  return n < 999_500 ? unit(n / 1000, "k") : unit(n / 1_000_000, "M");
}
