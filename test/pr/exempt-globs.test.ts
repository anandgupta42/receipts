// SPEC-0036 R2 amendment — the enforcement exempt-glob carve-out exists twice
// by design (the CI script runs uncompiled from a checkout; the npm-native
// pr-check ships compiled). This suite pins their PARITY the same way
// marker-parity pins DOGFOOD_MARKER: same inputs, same verdicts, always.
import { describe, expect, it } from "vitest";
import { globMatch, isExemptRef } from "../../src/pr/exemptGlobs.js";
import { isExemptRef as scriptIsExemptRef } from "../../scripts/check-pr-receipt.mjs";

const CASES: Array<[ref: string, globs: string]> = [
  ["release/v0.10.0", "release/*"],
  ["release/v0.10.0", ""],
  ["", "release/*"],
  ["release", "release/*"],
  ["release/", "release/*"],
  ["feat/release/x", "release/*"],
  ["chore/release-v1", "release/* chore/release-*"],
  ["ci/nightly", "release/*  ci/*"],
  ["feat/x", "release/*"],
  ["release.v1", "release.v*"],
  ["releaseXv1", "release.v*"],
  ["release/v1", "release/**"],
  ["release/a1a2a3Z", "release/*a*a*a*Z"],
  ["release/aaaa", "release/*a*a*a*Z"],
  ["main", "*"],
  ["release/x y", "release/*"],
];

describe("exempt-glob parity (src/pr/exemptGlobs.ts vs scripts/check-pr-receipt.mjs)", () => {
  it.each(CASES)("agrees on ref %j with globs %j", (ref, globs) => {
    expect(isExemptRef(ref, globs)).toBe(scriptIsExemptRef(ref, globs));
  });
});

describe("globMatch", () => {
  it("anchors matches on both ends", () => {
    expect(globMatch("release/v1", "release/*")).toBe(true);
    expect(globMatch("release/v1", "elease/*")).toBe(false);
    expect(globMatch("xrelease/v1", "release/*")).toBe(false);
    expect(globMatch("release", "release")).toBe(true);
    expect(globMatch("release", "release/*")).toBe(false);
  });

  it("stays fast on pathological patterns (no regex backtracking)", () => {
    const ref = `release/${"a".repeat(300)}`;
    const started = performance.now();
    expect(globMatch(ref, `release/${"*".repeat(8)}Z`)).toBe(false);
    expect(globMatch(ref, "release/*a*a*a*a*Z")).toBe(false);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("isExemptRef", () => {
  it("returns false for empty ref or empty globs", () => {
    expect(isExemptRef("", "release/*")).toBe(false);
    expect(isExemptRef("release/v1", "")).toBe(false);
  });

  it("matches any glob in a space-separated list", () => {
    expect(isExemptRef("ci/nightly", "release/* ci/*")).toBe(true);
    expect(isExemptRef("feat/x", "release/* ci/*")).toBe(false);
  });
});
