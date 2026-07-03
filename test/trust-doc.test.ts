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
});
