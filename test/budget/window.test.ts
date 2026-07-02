// R6 window-math tests for `src/budget/window.ts`. Pure functions, no I/O —
// every case uses an explicit frozen `now` (never `Date.now()`), per the
// spec's frozen-clock determinism requirement.
import { describe, expect, it } from "vitest";
import { dailyWindow, inWindow, weeklyWindow } from "../../src/budget/window.js";

const DAY_MS = 86_400_000;

describe("dailyWindow", () => {
  it("spans the UTC calendar day containing `now`", () => {
    const now = Date.UTC(2026, 5, 15, 14, 30, 0); // 2026-06-15T14:30:00Z
    const { start, end } = dailyWindow(now);
    expect(start).toBe(Date.UTC(2026, 5, 15, 0, 0, 0, 0));
    expect(end).toBe(start + DAY_MS);
  });

  it("is exact at the day boundary — 00:00:00.000Z is the start of that day, not the prior day", () => {
    const now = Date.UTC(2026, 5, 15, 0, 0, 0, 0);
    const { start } = dailyWindow(now);
    expect(start).toBe(now);
  });
});

describe("weeklyWindow", () => {
  it("is a half-open rolling 7-day span ending at `now`", () => {
    const now = Date.UTC(2026, 5, 15, 12, 0, 0);
    const { start, end } = weeklyWindow(now);
    expect(end).toBe(now);
    expect(start).toBe(now - 7 * DAY_MS);
  });
});

describe("inWindow", () => {
  const bounds = { start: 1000, end: 2000 };

  it("includes the start boundary (inclusive)", () => {
    expect(inWindow(1000, bounds)).toBe(true);
  });

  it("excludes the end boundary (exclusive — half-open)", () => {
    expect(inWindow(2000, bounds)).toBe(false);
  });

  it("excludes values outside the window", () => {
    expect(inWindow(999, bounds)).toBe(false);
    expect(inWindow(2001, bounds)).toBe(false);
  });

  it("always excludes `undefined` — never guesses a session into a window", () => {
    expect(inWindow(undefined, bounds)).toBe(false);
  });

  it("R6 date boundary: a session ending 23:59 UTC and one ending 00:01 UTC the next day land in different daily windows", () => {
    const day1 = Date.UTC(2026, 5, 15, 23, 59, 0);
    const day2 = Date.UTC(2026, 5, 16, 0, 1, 0);
    const now = Date.UTC(2026, 5, 16, 10, 0, 0); // "now" is on day2
    const bounds2 = dailyWindow(now);
    expect(inWindow(day1, bounds2)).toBe(false);
    expect(inWindow(day2, bounds2)).toBe(true);

    const boundsDay1 = dailyWindow(day1);
    expect(inWindow(day1, boundsDay1)).toBe(true);
    expect(inWindow(day2, boundsDay1)).toBe(false);
  });
});
