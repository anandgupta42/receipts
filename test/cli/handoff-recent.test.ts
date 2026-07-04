import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, SessionSummary, TokenUsage, Turn } from "../../src/parse/types.js";

vi.mock("../../src/index.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/index.js")>();
  return {
    ...actual,
    listSessions: vi.fn(),
    listFullSessions: vi.fn(),
    loadSession: vi.fn(),
  };
});

const index = await import("../../src/index.js");
const { recentWasteAggregates } = await import("../../src/cli/index.js");

const listSessionsMock = vi.mocked(index.listSessions);
const listFullSessionsMock = vi.mocked(index.listFullSessions);
const loadSessionMock = vi.mocked(index.loadSession);

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);

function usage(input: number): TokenUsage {
  return { input, output: 0, cacheRead: 0, cacheCreation: 0, total: input };
}

function summary(id: string, endedAt: number): SessionSummary {
  return {
    id,
    source: "claude-code",
    filePath: `/fake/${id}.jsonl`,
    startedAt: endedAt - 1000,
    endedAt,
    totals: { tokens: usage(0), turnCount: 1, toolCallCount: 3 },
  };
}

function wasteSession(id: string, endedAt: number): Session {
  const tokens = usage(3_000_000);
  const turn: Turn = {
    index: 0,
    timestamp: endedAt,
    model: "claude-opus-4-8",
    usage: tokens,
    toolCalls: [
      { name: "Bash", shell: true, input: { command: "npm test" } },
      { name: "Bash", shell: true, input: { command: "npm test" } },
      { name: "Bash", shell: true, input: { command: "npm test" } },
    ],
  };
  return {
    ...summary(id, endedAt),
    model: "claude-opus-4-8",
    totals: { tokens, turnCount: 1, toolCallCount: 3 },
    turns: [turn],
  };
}

beforeEach(() => {
  listSessionsMock.mockReset();
  listFullSessionsMock.mockReset();
  loadSessionMock.mockReset();
});

describe("recentWasteAggregates", () => {
  it("windows by full parsed endedAt, not the lazy summary's mtime-derived endedAt", async () => {
    const lazyMtimeSummary = summary("s", NOW - DAY_MS);
    const fullParsedSummary = summary("s", NOW - 10 * DAY_MS);
    listSessionsMock.mockResolvedValue([lazyMtimeSummary]);
    listFullSessionsMock.mockResolvedValue([fullParsedSummary]);
    loadSessionMock.mockResolvedValue(wasteSession("s", NOW - 10 * DAY_MS));

    await expect(recentWasteAggregates(NOW)).resolves.toEqual([]);
    expect(listFullSessionsMock).toHaveBeenCalledTimes(1);
    expect(listSessionsMock).not.toHaveBeenCalled();
    expect(loadSessionMock).not.toHaveBeenCalled();
  });
});
