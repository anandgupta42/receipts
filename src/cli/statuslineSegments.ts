// SPEC-0062 — the statusline segments engine. One renderer for the default
// line and `--format`: the default IS the format `brand,cost,tokens,waste,quota5h`
// (no duplicated truths). Every segment is an official payload passthrough, an
// existing SPEC-0007/0061 value, or the R4 labeled `≈` interpolation — a segment
// with nothing honest to say returns `null` and is omitted, never zero-filled
// (I2/I3). Unknown segment names fail fast: a typo'd format must not silently
// render a partial line.
import type { MiniSummary } from "../receipt/mini.js";
import { statuslineWasteFlag } from "../receipt/mini.js";
import { formatShortTokens, formatUsd } from "../receipt/format.js";
import {
  projectCapCrossingMs,
  quotaWindowPath,
  readPriorReading,
  writeReading,
  type QuotaReading,
} from "./quotaWindow.js";

export const DEFAULT_FORMAT = "brand,cost,burn,tokens,context,waste,quota5h";

export const SEGMENT_NAMES = ["brand", "cost", "burn", "tokens", "context", "waste", "quota5h", "quota7d", "quotaEta"] as const;
export type SegmentName = (typeof SEGMENT_NAMES)[number];

export interface SegmentContext {
  summary: MiniSummary;
  /** stdin payload mode vs. R3b disk fallback — drives the brand form and quota availability. */
  inputMode: "stdin_payload" | "disk_fallback";
  /** The parsed statusline stdin payload (unknown shape — every read is guarded). */
  payload: unknown;
  nowMs: number;
  /** State-file location override for tests; default resolves under `~/.aireceipts`. */
  quotaStatePath?: string;
}

/** Parse a format spec into segment names. Whitespace around commas is ignored; duplicates render twice (the format is literal). Returns the unknown/empty name on failure. */
export function parseFormat(spec: string): { segments: SegmentName[] } | { unknown: string } {
  const names = spec.split(",").map((s) => s.trim());
  const segments: SegmentName[] = [];
  for (const name of names) {
    if (!(SEGMENT_NAMES as readonly string[]).includes(name)) {
      return { unknown: name };
    }
    segments.push(name as SegmentName);
  }
  return { segments };
}

/** The official per-window payload fields, guarded exactly like `renderQuotaLines` (SPEC-0014 R4: absent/out-of-range → nothing). */
function quotaWindow(payload: unknown, key: "five_hour" | "seven_day"): { usedPercentage: number; resetsAt: number | null } | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const rateLimits = (payload as Record<string, unknown>).rate_limits;
  if (typeof rateLimits !== "object" || rateLimits === null) {
    return null;
  }
  const window = (rateLimits as Record<string, unknown>)[key];
  if (typeof window !== "object" || window === null) {
    return null;
  }
  const pct = (window as Record<string, unknown>).used_percentage;
  if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100) {
    return null;
  }
  const resets = (window as Record<string, unknown>).resets_at;
  return {
    usedPercentage: pct,
    resetsAt: typeof resets === "number" && Number.isFinite(resets) ? resets : null,
  };
}

function utcHhMm(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** R2 — Claude Code's pre-calculated `context_window.used_percentage` (0–100). Guarded like the rate-limit windows: absent/non-numeric/out-of-range → `null` (also rejects the CC epoch-timestamp bug). */
function contextPct(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const cw = (payload as Record<string, unknown>).context_window;
  if (typeof cw !== "object" || cw === null) {
    return null;
  }
  const pct = (cw as Record<string, unknown>).used_percentage;
  return typeof pct === "number" && Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : null;
}

/** A 5h/7d window never resets more than ~8 days out — a remaining time beyond this means a garbage `resets_at` (e.g. a ms value sent as seconds, or the CC epoch bug), so omit rather than render an absurd countdown (Codex #2). */
const MAX_RESET_COUNTDOWN_MS = 8 * 24 * 60 * 60 * 1000;

/** R4 — time until a rate-limit window resets, as `2h13m` / `45m`; `null` when `resets_at` is absent, already past, or absurdly far out (never a negative/fabricated time). `resetsAtSec` is epoch SECONDS. */
function resetCountdown(resetsAtSec: number | null, nowMs: number): string | null {
  if (resetsAtSec === null) {
    return null;
  }
  const remMs = resetsAtSec * 1000 - nowMs;
  if (!Number.isFinite(remMs) || remMs <= 0 || remMs > MAX_RESET_COUNTDOWN_MS) {
    return null;
  }
  const totalMin = Math.floor(remMs / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

/** R3 — a burn RATE `$/hr`: whole dollars once it's ≥ $1/hr (glanceable), else the cents. */
function formatRate(perHr: number): string {
  return perHr >= 1 ? String(Math.round(perHr)) : formatUsd(perHr);
}

/**
 * R4 — the `≈` ETA segment: reads the prior reading, persists the current one
 * (atomic, last-writer-wins), and projects only when every guard holds.
 */
function quotaEtaSegment(ctx: SegmentContext): string | null {
  const window = quotaWindow(ctx.payload, "five_hour");
  if (!window || window.resetsAt === null) {
    return null;
  }
  const current: QuotaReading = {
    observedAtMs: ctx.nowMs,
    usedPercentage: window.usedPercentage,
    resetsAt: window.resetsAt,
  };
  const statePath = ctx.quotaStatePath ?? quotaWindowPath();
  const prior = readPriorReading(statePath);
  writeReading(statePath, current);
  if (!prior) {
    return null;
  }
  const crossingMs = projectCapCrossingMs(prior, current);
  return crossingMs === null ? null : `≈ 5h cap ${utcHhMm(crossingMs)}`;
}

const SEGMENTS: Record<SegmentName, (ctx: SegmentContext) => string | null> = {
  // R1 — inside Claude Code's own status bar the host name is redundant; in
  // disk-fallback mode the newest session may be another agent's, so say whose.
  brand: (ctx) => (ctx.inputMode === "stdin_payload" ? "[aireceipts]" : `[aireceipts · ${ctx.summary.agentLabel}]`),
  cost: (ctx) =>
    !ctx.summary.unpriceable && ctx.summary.totalUsd !== null ? `$${formatUsd(ctx.summary.totalUsd)}` : null,
  tokens: (ctx) => formatShortTokens(ctx.summary.totalTokens),
  // R2 — Claude Code's pre-calculated context-window fullness; omitted when absent (I2/I3).
  context: (ctx) => {
    const p = contextPct(ctx.payload);
    return p === null ? null : `ctx ${Math.round(p)}%`;
  },
  // R3 — session-average burn rate from aireceipts' OWN priced ledger (I2 — no fabricated $/hr).
  burn: (ctx) => {
    const { totalUsd, durationMs, unpriceable } = ctx.summary;
    if (unpriceable || totalUsd === null || !Number.isFinite(totalUsd) || totalUsd < 0 || durationMs === undefined || !Number.isFinite(durationMs) || durationMs <= 0) {
      return null;
    }
    const perHr = totalUsd / (durationMs / 3_600_000);
    return Number.isFinite(perHr) ? `$${formatRate(perHr)}/hr` : null;
  },
  waste: (ctx) => (ctx.summary.topWaste ? statuslineWasteFlag(ctx.summary.topWaste) : null),
  quota5h: (ctx) => {
    const w = quotaWindow(ctx.payload, "five_hour");
    if (!w) {
      return null;
    }
    const cd = resetCountdown(w.resetsAt, ctx.nowMs);
    return cd ? `5h ${Math.round(w.usedPercentage)}% ↺${cd}` : `5h ${Math.round(w.usedPercentage)}%`;
  },
  quota7d: (ctx) => {
    const w = quotaWindow(ctx.payload, "seven_day");
    if (!w) {
      return null;
    }
    const cd = resetCountdown(w.resetsAt, ctx.nowMs);
    return cd ? `7d ${Math.round(w.usedPercentage)}% ↺${cd}` : `7d ${Math.round(w.usedPercentage)}%`;
  },
  quotaEta: quotaEtaSegment,
};

/**
 * Render a segment list: `null` segments are omitted; a leading `brand` is a
 * prefix (space-joined, SPEC-0007's shape), everything else `·`-joined.
 * Each segment is evaluated at most once per render (memoized by name), so a
 * duplicated segment renders the same text twice — R3's "the format is
 * literal" — and the stateful `quotaEta` reads/writes its state file exactly
 * once per invocation regardless of how many times the format names it.
 */
export function renderSegments(segments: SegmentName[], ctx: SegmentContext): string {
  const memo = new Map<SegmentName, string | null>();
  const rendered: { name: SegmentName; text: string }[] = [];
  for (const name of segments) {
    if (!memo.has(name)) {
      memo.set(name, SEGMENTS[name](ctx));
    }
    const text = memo.get(name) ?? null;
    if (text !== null) {
      rendered.push({ name, text });
    }
  }
  if (rendered.length === 0) {
    return "";
  }
  if (segments[0] === "brand" && rendered[0]?.name === "brand") {
    const rest = rendered.slice(1).map((r) => r.text);
    return rest.length > 0 ? `${rendered[0].text} ${rest.join(" · ")}` : rendered[0].text;
  }
  return rendered.map((r) => r.text).join(" · ");
}
