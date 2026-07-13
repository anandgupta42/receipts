import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../../src/parse/types.js";

const { listSessions } = vi.hoisted(() => ({ listSessions: vi.fn() }));

vi.mock("../../src/parse/registry.js", () => ({
  adapterFor: () => undefined,
  adapters: () => [
    {
      id: "opencode",
      label: "opencode",
      roots: () => ["/tmp/opencode"],
      detect: async () => true,
      listSessions,
      loadSession: async () => null,
    },
  ],
  detectedAdapters: async () => [],
}));

import { listFullSessions } from "../../src/parse/load.js";

const summary: SessionSummary = {
  id: "db#session",
  source: "opencode",
  filePath: "/tmp/opencode/sessions.db",
  totals: {
    tokens: { input: 1, output: 2, cacheRead: 0, cacheCreation: 0, total: 3 },
    turnCount: 1,
    toolCallCount: 0,
  },
};

describe("SPEC-0082 bounded opencode enumeration", () => {
  beforeEach(() => {
    listSessions.mockReset();
    listSessions.mockResolvedValue([summary]);
  });

  it("uses completed SQL summaries without loading every session body", async () => {
    await expect(listFullSessions("opencode")).resolves.toEqual([summary]);
    expect(listSessions).toHaveBeenCalledOnce();
    expect(listSessions).toHaveBeenCalledWith();
  });
});
