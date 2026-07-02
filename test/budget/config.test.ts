// R1/R5 tests for `src/budget/config.ts` — schema validation and graceful
// degradation for `~/.aireceipts/budget.json`. Mirrors `src/telemetry/
// notice.test.ts`'s mkdtemp `homeOverride` pattern (never touches the real
// home directory).
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { budgetFilePath, loadBudgetConfig, validateBudgetConfig } from "../../src/budget/config.js";

describe("budgetFilePath", () => {
  const originalEnv = process.env.AIRECEIPTS_HOME;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AIRECEIPTS_HOME;
    } else {
      process.env.AIRECEIPTS_HOME = originalEnv;
    }
  });

  it("prefers an explicit homeOverride param over everything else", () => {
    process.env.AIRECEIPTS_HOME = "/env-home";
    expect(budgetFilePath("/direct-home")).toBe(join("/direct-home", ".aireceipts", "budget.json"));
  });

  it("falls back to AIRECEIPTS_HOME when no homeOverride is given (R1: homedir override via env for tests)", () => {
    process.env.AIRECEIPTS_HOME = "/env-home";
    expect(budgetFilePath()).toBe(join("/env-home", ".aireceipts", "budget.json"));
  });
});

describe("validateBudgetConfig (R1 schema)", () => {
  it("accepts a daily-only USD config", () => {
    const result = validateBudgetConfig({ daily: { usd: 50 } });
    expect(result.ok).toBe(true);
  });

  it("accepts a weekly-only token config", () => {
    const result = validateBudgetConfig({ weekly: { tokens: 1_000_000 } });
    expect(result.ok).toBe(true);
  });

  it("accepts both daily and weekly, each with its own cap kind", () => {
    const result = validateBudgetConfig({ daily: { usd: 50 }, weekly: { tokens: 5_000_000 } });
    expect(result.ok).toBe(true);
  });

  it("rejects a period with both usd and tokens set (mutually exclusive per period)", () => {
    const result = validateBudgetConfig({ daily: { usd: 50, tokens: 100 } });
    expect(result.ok).toBe(false);
  });

  it("rejects a period with neither usd nor tokens set", () => {
    const result = validateBudgetConfig({ daily: {} });
    expect(result.ok).toBe(false);
  });

  it("rejects an object with no daily and no weekly", () => {
    const result = validateBudgetConfig({});
    expect(result.ok).toBe(false);
  });

  it("rejects unknown top-level keys", () => {
    const result = validateBudgetConfig({ daily: { usd: 50 }, monthly: { usd: 500 } });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-object payload", () => {
    expect(validateBudgetConfig(null).ok).toBe(false);
    expect(validateBudgetConfig("50").ok).toBe(false);
    expect(validateBudgetConfig(42).ok).toBe(false);
  });

  it.each([0, -10, NaN, Infinity, -Infinity])("rejects an out-of-range cap value %p", (bad) => {
    const result = validateBudgetConfig({ daily: { usd: bad } });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-numeric cap value", () => {
    const result = validateBudgetConfig({ daily: { usd: "50" } });
    expect(result.ok).toBe(false);
  });
});

describe("loadBudgetConfig (R1/R5)", () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "aireceipts-budget-config-test-"));
  });

  afterEach(async () => {
    await rm(homeDir, { recursive: true, force: true });
  });

  async function writeBudgetJson(contents: string): Promise<void> {
    const dir = join(homeDir, ".aireceipts");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "budget.json"), contents, "utf8");
  }

  it("R1: returns status \"absent\" when no budget.json exists", async () => {
    const result = await loadBudgetConfig(homeDir);
    expect(result).toEqual({ status: "absent" });
  });

  it("R1: returns the parsed config when the file is valid", async () => {
    await writeBudgetJson(JSON.stringify({ daily: { usd: 50 } }));
    const result = await loadBudgetConfig(homeDir);
    expect(result).toEqual({ status: "ok", config: { daily: { usd: 50 } } });
  });

  it("R5: malformed JSON degrades to \"invalid\" with a reason, never throws", async () => {
    await writeBudgetJson("{ this is not valid json");
    const result = await loadBudgetConfig(homeDir);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.reason).toContain("not valid JSON");
    }
  });

  it("R5: an out-of-range cap degrades to \"invalid\" with a reason, never throws", async () => {
    await writeBudgetJson(JSON.stringify({ daily: { usd: -5 } }));
    const result = await loadBudgetConfig(homeDir);
    expect(result.status).toBe("invalid");
  });
});
