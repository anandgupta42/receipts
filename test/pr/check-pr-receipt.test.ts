// SPEC-0019 R5 — the CI presence check's pure verdict, and marker parity with
// the renderer (the .mjs mirror is what CI runs; it must agree with src/pr/body.ts).
import { describe, expect, it } from "vitest";
import { DOGFOOD_MARKER as SCRIPT_MARKER, hasReceiptComment } from "../../scripts/check-pr-receipt.mjs";
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

describe("marker parity", () => {
  it("the script marker equals the renderer marker", () => {
    expect(SCRIPT_MARKER).toBe(BODY_MARKER);
  });
});
