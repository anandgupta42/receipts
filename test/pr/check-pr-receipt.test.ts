// SPEC-0019 R5 — the CI presence check's pure verdict, and marker parity with
// the renderer (the .mjs mirror is what CI runs; it must agree with src/pr/body.ts).
import { describe, expect, it } from "vitest";
import {
  DOGFOOD_MARKER as SCRIPT_MARKER,
  hasReceiptComment,
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
});

describe("marker parity", () => {
  it("the script marker equals the renderer marker", () => {
    expect(SCRIPT_MARKER).toBe(BODY_MARKER);
  });
});
