// SPEC-0062 R4 — the quota-window state file behind the `quotaEta` segment.
// One prior reading, `~/.aireceipts/quota-window.json`: a cache, never a
// ledger. Atomic write (temp + rename), self-healing on any unreadable/
// invalid content, last-writer-wins under concurrent invocations. The ETA is
// straight-line interpolation between exactly two observed readings, and it
// renders ONLY when every guard holds — ambiguity is answered with omission,
// never a number (I3).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** One observed reading of the 5h window, as Claude Code's payload states it. */
export interface QuotaReading {
  observedAtMs: number;
  usedPercentage: number;
  /** `rate_limits.five_hour.resets_at`, Unix epoch seconds. */
  resetsAt: number;
}

/** Minimum spacing between readings for the interpolation to mean anything. */
export const MIN_READING_GAP_MS = 60_000;

export function quotaWindowPath(homeOverride?: string): string {
  return join(homeOverride ?? process.env.AIRECEIPTS_HOME ?? homedir(), ".aireceipts", "quota-window.json");
}

function isReading(value: unknown): value is QuotaReading {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v.observedAtMs === "number" &&
    Number.isFinite(v.observedAtMs) &&
    typeof v.usedPercentage === "number" &&
    Number.isFinite(v.usedPercentage) &&
    v.usedPercentage >= 0 &&
    v.usedPercentage <= 100 &&
    typeof v.resetsAt === "number" &&
    Number.isFinite(v.resetsAt)
  );
}

/** Read the prior reading; any unreadable/invalid state is `null` (self-healing — the next write replaces it). */
export function readPriorReading(filePath: string): QuotaReading | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    return isReading(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Persist the current reading atomically (temp + rename); failures are swallowed — the segment simply stays cold. */
export function writeReading(filePath: string, reading: QuotaReading): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(reading)}\n`);
    renameSync(tmp, filePath);
  } catch {
    // Best-effort cache: an unwritable state dir must never break the statusline.
  }
}

/**
 * The projected cap-crossing time, or `null` when any guard fails. Guards, each
 * decidable from the two readings alone: same window (`resetsAt` identical),
 * rising usage, readings ≥ 60s apart, the prior reading not in the future
 * (clock skew), and the straight-line crossing landing before the window
 * resets (an ETA after reset is meaningless).
 */
export function projectCapCrossingMs(prior: QuotaReading, current: QuotaReading): number | null {
  if (prior.resetsAt !== current.resetsAt) {
    return null;
  }
  if (prior.observedAtMs > current.observedAtMs) {
    return null;
  }
  const gapMs = current.observedAtMs - prior.observedAtMs;
  if (gapMs < MIN_READING_GAP_MS) {
    return null;
  }
  if (current.usedPercentage <= prior.usedPercentage) {
    return null;
  }
  const ratePerMs = (current.usedPercentage - prior.usedPercentage) / gapMs;
  const crossingMs = current.observedAtMs + (100 - current.usedPercentage) / ratePerMs;
  if (crossingMs >= current.resetsAt * 1000) {
    return null;
  }
  // Garbage-payload backstop: a finite-but-absurd `resets_at` could admit a
  // crossing outside `Date`'s representable range — omit rather than render
  // `NaN:NaN` (max ECMAScript time value: ±8.64e15 ms).
  if (!Number.isFinite(crossingMs) || Math.abs(crossingMs) > 8.64e15) {
    return null;
  }
  return crossingMs;
}
