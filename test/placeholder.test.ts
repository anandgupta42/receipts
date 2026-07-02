import { describe, expect, it } from "vitest";

// Keeps `vitest run` green at Tier 0 (harness only, no product code yet).
// Delete once the first real test for src/parse|pricing|receipt|cli lands.
describe("harness placeholder", () => {
  it("has a working test runner", () => {
    expect(1 + 1).toBe(2);
  });
});
