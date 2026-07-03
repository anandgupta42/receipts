// SPEC-0028 R4 — the trust doc exists, is linked from the README, and every
// capability it names maps to a shipped surface (the greps below are the
// mechanical half of the doc-parity matrix row; the prose half is review).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("docs/trust.md", () => {
  const doc = readFileSync("docs/trust.md", "utf8");

  it("is linked from the README docs line", () => {
    expect(readFileSync("README.md", "utf8")).toContain("docs/trust.md");
  });

  it("names the shipped verification surfaces it relies on", () => {
    expect(doc).toContain("scripts/cost-reconcile.mjs");
    expect(doc).toContain("caveat");
    expect(doc).toContain("--methodology");
  });

  it("states the limit plainly — no attestation pretense", () => {
    expect(doc).toContain("cannot prove");
    expect(doc).toContain("author's disclosure");
  });

  it("keeps the living failure-scenario list — present, growing, never shrinking below its floor", () => {
    expect(doc).toContain("## Where the numbers can go wrong");
    const section = doc.split("## Where the numbers can go wrong")[1];
    const entries = section.match(/^\d+\. \*\*/gm) ?? [];
    // 10 scenarios at introduction (2026-07-03). Add entries freely; removing
    // one must be a conscious act that updates this floor with justification.
    expect(entries.length).toBeGreaterThanOrEqual(10);
  });
});
