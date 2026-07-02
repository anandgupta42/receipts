import { describe, expect, it } from "vitest";
import { dottedLine } from "../../src/receipt/format.js";

describe("dottedLine — long labels never move the value column (A4)", () => {
  it("truncates with … and keeps the value flush right at fixed width", () => {
    const w = 50;
    const line = dottedLine("mcp__claude-in-chrome__browser_batch", "$2.60  (19 calls)", w);
    expect(line.length).toBe(w);
    expect(line.endsWith("$2.60  (19 calls)")).toBe(true);
    expect(line).toContain("…");
  });
  it("short labels are byte-identical to before (goldens guard this too)", () => {
    expect(dottedLine("Bash", "$0.05", 20)).toBe("Bash...........$0.05");
  });
});

describe("cache line display honesty", () => {
  it("never rounds a partial cache ratio up to 100%", async () => {
    const { buildReceiptView } = await import("../../src/receipt/present.js");
    const { loadById } = await import("../../src/index.js");
    const { buildReceiptModel } = await import("../../src/receipt/model.js");
    const m = await buildReceiptModel((await loadById("claude-code", "test/fixtures/claude-code/clean-multi-tool-2-models.jsonl"))!);
    const tweaked = { ...m, totalTokens: { ...m.totalTokens, input: 1, cacheRead: 10000, cacheCreation: 0 } };
    const view = buildReceiptView(tweaked) as any;
    const all = JSON.stringify(view);
    expect(all).toContain("cache served >99% of input tokens");
    expect(all).not.toContain("cache served 100%");
  });
});
