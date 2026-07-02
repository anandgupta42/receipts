// R2/R6 window math for daily/weekly budget sums. `dailyWindow` is a UTC
// calendar day — independent of SPEC-0008. `weeklyWindow` semantically
// matches SPEC-0008's `windowBounds` current-window contract (a half-open
// `[now-7d, now)` rolling span, `endedAt`-bucketed) without importing it:
// SPEC-0008 lives on an unmerged sibling branch (`feat/spec-0008-weekly-
// digest`, not yet on `origin/main`), and this spec only needs the "current
// window" half of that contract — no prior-window delta, no digest output.
// If SPEC-0008 merges first, this can be swapped for its `windowBounds`
// current half with no change to callers.
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Half-open epoch-ms window: `[start, end)`. */
export interface WindowBounds {
  start: number;
  end: number;
}

/** UTC calendar day containing `now`: `[00:00:00.000Z that day, 00:00:00.000Z next day)`. */
export function dailyWindow(now: number): WindowBounds {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return { start, end: start + DAY_MS };
}

/** Rolling 7-day window ending at `now`: `[now - 7d, now)`. */
export function weeklyWindow(now: number): WindowBounds {
  return { start: now - WEEK_MS, end: now };
}

/** `true` when `endedAt` falls in `[bounds.start, bounds.end)`. `undefined` (no `endedAt`) is always excluded — never guessed into a window (mirrors SPEC-0008 R1). */
export function inWindow(endedAt: number | undefined, bounds: WindowBounds): boolean {
  return endedAt !== undefined && endedAt >= bounds.start && endedAt < bounds.end;
}
