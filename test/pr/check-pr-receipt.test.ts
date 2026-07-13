// SPEC-0019 R5 — the CI presence check's pure verdict, and marker parity with
// the renderer (the .mjs mirror is what CI runs; it must agree with src/pr/body.ts).
import { describe, expect, it } from "vitest";
import {
  DOGFOOD_MARKER as SCRIPT_MARKER,
  hasReceiptComment,
  isExemptRef,
  receiptCheckVerdict,
} from "../../scripts/check-pr-receipt.mjs";
import { DOGFOOD_MARKER as BODY_MARKER } from "../../src/pr/body.js";

describe("hasReceiptComment", () => {
  it("finds a comment whose body starts with the marker", () => {
    const json = JSON.stringify([{ body: "hello" }, { body: `${SCRIPT_MARKER}\n🧾 receipt` }]);
    expect(hasReceiptComment(json)).toBe(true);
  });

  it("returns false when no comment carries the marker", () => {
    expect(hasReceiptComment(JSON.stringify([{ body: "just a review" }]))).toBe(false);
    expect(hasReceiptComment("[]")).toBe(false);
    expect(hasReceiptComment("not json")).toBe(false);
  });

  it("keys on the marker only — never on comment author (SPEC-0052 R3)", () => {
    // A marked comment counts regardless of who authored it, and an unmarked
    // bot comment never counts — the marker is the whole contract.
    const markedByHuman = JSON.stringify([
      { body: "chatter", user: { login: "aireceipts[bot]" } },
      { body: `${SCRIPT_MARKER}\nreceipt`, user: { login: "alice" } },
    ]);
    expect(hasReceiptComment(markedByHuman)).toBe(true);
    const onlyUnmarkedBot = JSON.stringify([{ body: "not a receipt", user: { login: "aireceipts[bot]" } }]);
    expect(hasReceiptComment(onlyUnmarkedBot)).toBe(false);
  });
});

describe("receiptCheckVerdict", () => {
  it("returns found when the marked comment is present", () => {
    const json = JSON.stringify([{ body: `${SCRIPT_MARKER}\nreceipt` }]);
    expect(receiptCheckVerdict(json, { headRepo: "owner/repo", baseRepo: "owner/repo" })).toBe("found");
  });

  it("keeps same-repo PRs notice-only by default", () => {
    expect(receiptCheckVerdict("[]", { headRepo: "owner/repo", baseRepo: "owner/repo" })).toBe("missing-notice");
  });

  it("requires same-repo PRs only when enforcement is enabled", () => {
    expect(receiptCheckVerdict("[]", { headRepo: "owner/repo", baseRepo: "owner/repo", requireSameRepo: true })).toBe(
      "missing-required",
    );
  });

  it("keeps fork and unknown PRs notice-only", () => {
    expect(receiptCheckVerdict("[]", { headRepo: "fork/repo", baseRepo: "owner/repo", requireSameRepo: true })).toBe(
      "missing-notice",
    );
    expect(receiptCheckVerdict("[]")).toBe("missing-notice");
  });

  it("keeps exempt branches notice-only under enforcement", () => {
    const opts = { headRepo: "owner/repo", baseRepo: "owner/repo", requireSameRepo: true };
    expect(receiptCheckVerdict("[]", { ...opts, headRef: "release/v0.10.0", exemptGlobs: "release/*" })).toBe(
      "missing-notice",
    );
    expect(
      receiptCheckVerdict("[]", { ...opts, headRef: "chore/release-v1", exemptGlobs: "release/* chore/release-*" }),
    ).toBe("missing-notice");
  });

  it("still requires non-exempt branches under enforcement", () => {
    const opts = { headRepo: "owner/repo", baseRepo: "owner/repo", requireSameRepo: true };
    expect(receiptCheckVerdict("[]", { ...opts, headRef: "feat/x", exemptGlobs: "release/*" })).toBe(
      "missing-required",
    );
    // No globs configured, or no head ref supplied: enforcement is unchanged.
    expect(receiptCheckVerdict("[]", { ...opts, headRef: "release/v0.10.0" })).toBe("missing-required");
    expect(receiptCheckVerdict("[]", { ...opts, exemptGlobs: "release/*" })).toBe("missing-required");
  });
});

describe("isExemptRef", () => {
  it("matches shell-style globs, anchored", () => {
    expect(isExemptRef("release/v0.10.0", "release/*")).toBe(true);
    expect(isExemptRef("feat/release/x", "release/*")).toBe(false);
    expect(isExemptRef("release", "release/*")).toBe(false);
    expect(isExemptRef("ci/nightly", "release/* ci/*")).toBe(true);
  });

  it("treats regex metacharacters in globs literally", () => {
    expect(isExemptRef("releaseXv1", "release.v*")).toBe(false);
    expect(isExemptRef("release.v1", "release.v*")).toBe(true);
  });

  it("stays fast on pathological globs (no regex backtracking)", () => {
    const ref = `release/${"a".repeat(300)}`;
    const started = performance.now();
    expect(isExemptRef(ref, `release/${"*".repeat(8)}Z`)).toBe(false);
    expect(isExemptRef(ref, "release/*a*a*a*a*Z")).toBe(false);
    expect(performance.now() - started).toBeLessThan(200);
    expect(isExemptRef("release/v1", "release/**")).toBe(true);
    expect(isExemptRef("release/a1a2a3Z", "release/*a*a*a*Z")).toBe(true);
  });
});

describe("marker parity", () => {
  it("the script marker equals the renderer marker", () => {
    expect(SCRIPT_MARKER).toBe(BODY_MARKER);
  });
});
