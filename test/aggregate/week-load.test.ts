import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../../src/parse/types.js";

vi.mock("../../src/parse/load.js", () => ({
  listFullSessions: vi.fn(),
  loadSession: vi.fn(),
}));

const { listFullSessions, loadSession } = await import("../../src/parse/load.js");
const { buildWeekDigest } = await import("../../src/aggregate/week.js");

const listSessionsMock = vi.mocked(listFullSessions);
const loadSessionMock = vi.mocked(loadSession);
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);

function unreadableSummary(): SessionSummary {
  return {
    id: "unreadable",
    source: "claude-code",
    filePath: "/fake/unreadable.jsonl",
    endedAt: NOW - 1_000,
    totals: {
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 },
      turnCount: 0,
      toolCallCount: 0,
    },
    degraded: "unreadable",
  };
}

beforeEach(() => {
  listSessionsMock.mockReset();
  loadSessionMock.mockReset();
});

describe("buildWeekDigest load coverage", () => {
  it("keeps an in-window degraded summary in the denominator when full loading fails", async () => {
    listSessionsMock.mockResolvedValue([unreadableSummary()]);
    loadSessionMock.mockResolvedValue(null);

    const digest = await buildWeekDigest({ now: NOW });

    expect(listSessionsMock).toHaveBeenCalledWith(undefined, { includeDegraded: true });
    expect(digest.current.sessionCount).toBe(1);
    expect(digest.current.unreadableSessionCount).toBe(1);
    expect(digest.current.excludedSessionCount).toBe(1);
    expect(digest.current.tokenTotal.total).toBe(0);
  });

  it("excludes child summaries from the week scope before loading", async () => {
    const child = { ...unreadableSummary(), id: "child", isSidechain: true };
    listSessionsMock.mockResolvedValue([child]);

    const digest = await buildWeekDigest({ now: NOW });

    expect(loadSessionMock).not.toHaveBeenCalled();
    expect(digest.current.sessionCount).toBe(0);
  });
});
