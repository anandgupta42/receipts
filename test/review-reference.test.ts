import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("generated session review reference", () => {
  it("matches the production pattern registry", () => {
    const result = spawnSync(process.execPath, ["scripts/generate-review-reference.mjs", "--check"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it("explains cost and hidden-pattern states without implying hidden rules can render", () => {
    const reference = readFileSync("docs/reference/review-patterns.md", "utf8");
    expect(reference).toContain("Status: Shown as a cost opportunity");
    expect(reference).toContain("If enabled later, its recurrence rule would require at least 3 distinct sessions");
  });
});
