// R2/R3/R4/R5/R6 tests for `src/budget/line.ts` — line rendering, the
// exceeded predicate, and `evaluateBudget`'s full orchestration. Mocks
// `../../src/parse/load.js` (same reason as `compute.test.ts`: no
// fixture-injection point exists for real session data) and uses real
// temp `budget.json` files via `homeOverride` (same pattern as
// `config.test.ts`/`notice.test.ts`) for the config half.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../../src/parse/types.js";
import type { BudgetSum } from "../../src/budget/compute.js";

vi.mock("../../src/parse/load.js", () => ({
  listFullSessions: vi.fn(),
  loadSession: vi.fn(),
}));

const { listFullSessions } = await import("../../src/parse/load.js");
const { budgetExceeded, evaluateBudget, renderBudgetLine } = await import("../../src/budget/line.js");

const listSessionsMock = vi.mocked(listFullSessions);

describe("renderBudgetLine (R2, R4)", () => {
  it("R4: a usd line always states it is advisory only and never claims enforcement", () => {
    const sum: BudgetSum = { kind: "usd", spent: 10, cap: 50, sessionCount: 1, excludedUnpricedCount: 0 };
    const line = renderBudgetLine("daily", sum);
    expect(line).toBe("budget (today): $10.00 of $50.00 — advisory only — does not stop the agent");
    expect(line.toLowerCase()).not.toMatch(/stopped|blocked|halted|killed|throttled the agent/);
  });

  it("R2: a usd line with excluded unpriced sessions notes the count (singular)", () => {
    const sum: BudgetSum = { kind: "usd", spent: 10, cap: 50, sessionCount: 1, excludedUnpricedCount: 1 };
    const line = renderBudgetLine("weekly", sum);
    expect(line).toContain("(1 unpriced session excluded from this sum)");
  });

  it("R2: a usd line with multiple excluded unpriced sessions notes the count (plural)", () => {
    const sum: BudgetSum = { kind: "usd", spent: 10, cap: 50, sessionCount: 1, excludedUnpricedCount: 3 };
    const line = renderBudgetLine("daily", sum);
    expect(line).toContain("(3 unpriced sessions excluded from this sum)");
  });

  it("R4: a token line also states advisory-only", () => {
    const sum: BudgetSum = { kind: "tokens", spentTokens: 1500, cap: 10_000, sessionCount: 2 };
    const line = renderBudgetLine("daily", sum);
    expect(line).toBe("budget (today): 1,500 of 10,000 tokens — advisory only — does not stop the agent");
  });
});

describe("budgetExceeded (R3)", () => {
  it("is false when spend equals the cap exactly (strict >)", () => {
    expect(budgetExceeded({ kind: "usd", spent: 50, cap: 50, sessionCount: 1, excludedUnpricedCount: 0 })).toBe(false);
    expect(budgetExceeded({ kind: "tokens", spentTokens: 10_000, cap: 10_000, sessionCount: 1 })).toBe(false);
  });

  it("is true when spend exceeds the cap", () => {
    expect(budgetExceeded({ kind: "usd", spent: 50.01, cap: 50, sessionCount: 1, excludedUnpricedCount: 0 })).toBe(true);
    expect(budgetExceeded({ kind: "tokens", spentTokens: 10_001, cap: 10_000, sessionCount: 1 })).toBe(true);
  });

  it("is false when spend is under the cap", () => {
    expect(budgetExceeded({ kind: "usd", spent: 10, cap: 50, sessionCount: 1, excludedUnpricedCount: 0 })).toBe(false);
  });
});

describe("evaluateBudget (R1/R2/R3/R5/R6 orchestration)", () => {
  let homeDir: string;
  const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "aireceipts-budget-line-test-"));
    listSessionsMock.mockReset();
    listSessionsMock.mockResolvedValue([]);
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  async function writeBudgetJson(contents: string): Promise<void> {
    const dir = join(homeDir, ".aireceipts");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "budget.json"), contents, "utf8");
  }

  it("R1/I5: absent file yields no lines and never reports exceeded", async () => {
    const result = await evaluateBudget(NOW, homeDir);
    expect(result).toEqual({ status: "absent", lines: [], exceeded: false });
  });

  it("R5: an invalid file yields no lines, a reason, and exit-relevant status \"invalid\" (never crashes)", async () => {
    await writeBudgetJson("not json at all {{{");
    const result = await evaluateBudget(NOW, homeDir);
    expect(result.status).toBe("invalid");
    expect(result.lines).toEqual([]);
    expect(result.exceeded).toBe(false);
    expect(result.invalidReason).toBeTruthy();
  });

  it("R2: a daily-only token budget under cap produces exactly one line and is not exceeded", async () => {
    await writeBudgetJson(JSON.stringify({ daily: { tokens: 10_000 } }));
    const s: SessionSummary = {
      id: "s1",
      source: "claude-code",
      filePath: "/fake/s1.jsonl",
      endedAt: NOW - 1000,
      totals: { tokens: { input: 100, output: 0, cacheRead: 0, cacheCreation: 0, total: 100 }, turnCount: 1, toolCallCount: 0 },
    };
    listSessionsMock.mockResolvedValue([s]);

    const result = await evaluateBudget(NOW, homeDir);

    expect(result.status).toBe("ok");
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toContain("100 of 10,000 tokens");
    expect(result.exceeded).toBe(false);
  });

  it("R3: a daily-only token budget over cap reports exceeded", async () => {
    await writeBudgetJson(JSON.stringify({ daily: { tokens: 100 } }));
    const s: SessionSummary = {
      id: "s1",
      source: "claude-code",
      filePath: "/fake/s1.jsonl",
      endedAt: NOW - 1000,
      totals: { tokens: { input: 500, output: 0, cacheRead: 0, cacheCreation: 0, total: 500 }, turnCount: 1, toolCallCount: 0 },
    };
    listSessionsMock.mockResolvedValue([s]);

    const result = await evaluateBudget(NOW, homeDir);

    expect(result.exceeded).toBe(true);
  });

  it("both daily and weekly configured yields two lines; exceeded is true if either period is over", async () => {
    await writeBudgetJson(JSON.stringify({ daily: { tokens: 50 }, weekly: { tokens: 1_000_000 } }));
    const s: SessionSummary = {
      id: "s1",
      source: "claude-code",
      filePath: "/fake/s1.jsonl",
      endedAt: NOW - 1000,
      totals: { tokens: { input: 500, output: 0, cacheRead: 0, cacheCreation: 0, total: 500 }, turnCount: 1, toolCallCount: 0 },
    };
    listSessionsMock.mockResolvedValue([s]);

    const result = await evaluateBudget(NOW, homeDir);

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toContain("today");
    expect(result.lines[1]).toContain("this week");
    // daily cap (50) is blown by the 500-token session; weekly (1,000,000) is not.
    expect(result.exceeded).toBe(true);
  });
});
