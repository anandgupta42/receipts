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
