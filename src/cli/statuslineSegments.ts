// SPEC-0062 — the statusline segments engine. One renderer for the default
// line and `--format`: the default IS the format `brand,cost,tokens,waste,quota5h`
// (no duplicated truths). Every segment is an official payload passthrough, an
// existing SPEC-0007/0061 value, or the R4 labeled `≈` interpolation — a segment
// with nothing honest to say returns `null` and is omitted, never zero-filled
// (I2/I3). Unknown segment names fail fast: a typo'd format must not silently
// render a partial line.
import type { MiniSummary } from "../receipt/mini.js";
import { statuslineWasteFlag } from "../receipt/mini.js";
import { formatTokensK, formatUsd } from "../receipt/format.js";
import {
  projectCapCrossingMs,
  quotaWindowPath,
  readPriorReading,
  writeReading,
  type QuotaReading,
} from "./quotaWindow.js";

export const DEFAULT_FORMAT = "brand,cost,tokens,waste,quota5h";

export const SEGMENT_NAMES = ["brand", "cost", "tokens", "waste", "quota5h", "quota7d", "quotaEta"] as const;
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
  tokens: (ctx) => formatTokensK(ctx.summary.totalTokens),
  waste: (ctx) => (ctx.summary.topWaste ? statuslineWasteFlag(ctx.summary.topWaste) : null),
  quota5h: (ctx) => {
    const w = quotaWindow(ctx.payload, "five_hour");
    return w ? `5h ${Math.round(w.usedPercentage)}%` : null;
  },
  quota7d: (ctx) => {
    const w = quotaWindow(ctx.payload, "seven_day");
    return w ? `7d ${Math.round(w.usedPercentage)}%` : null;
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
