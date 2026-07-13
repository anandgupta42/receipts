// SPEC-0066 R1/R3 — the CI render path (no write token): fetch the ref, validate +
// sanitize + render. No ref → 2, unreadable → 2, invalid payload → 3 (no body), valid → 0
// with the SANITIZED body. No `gh`/token is involved — posting is a separate audited step.
import { describe, expect, it } from "vitest";
import { fetchAndRenderReceipt, renderReceiptPayload, type FetchRenderDeps } from "../../src/pr/postRef.js";
import { PR_RECEIPT_SCHEMA_VERSION } from "../../src/pr/payloadTypes.js";

const ARGS = { branch: "feat/x", remoteUrl: "https://example.com/r.git" };

describe("fetchAndRenderReceipt", () => {
  it("returns code 2 when no ref is fetched", () => {
    const deps: FetchRenderDeps = { fetchRef: () => false, readRef: () => null };
    const out = fetchAndRenderReceipt(ARGS, deps);
    expect(out.code).toBe(2);
    expect(out.body).toBeUndefined();
  });

  it("returns code 2 when the ref is present but receipt.json is unreadable", () => {
    const deps: FetchRenderDeps = { fetchRef: () => true, readRef: () => null };
    expect(fetchAndRenderReceipt(ARGS, deps).code).toBe(2);
  });

  it("returns code 3 on an invalid payload and renders no body", () => {
    const deps: FetchRenderDeps = { fetchRef: () => true, readRef: () => "{not json" };
    const out = fetchAndRenderReceipt(ARGS, deps);
    expect(out.code).toBe(3);
    expect(out.body).toBeUndefined();
  });

  it("returns code 0 with the SANITIZED body on a valid payload", () => {
    const hostile = JSON.stringify({
      schemaVersion: PR_RECEIPT_SCHEMA_VERSION,
      bodyInput: { contributors: [], excludedCount: 0 },
      extras: { details: [{ label: "[x](javascript:alert(1))", row: [], text: "t" }], artifactLink: { fileName: "p.html", url: "javascript:alert(1)" } },
    });
    const deps: FetchRenderDeps = { fetchRef: () => true, readRef: () => hostile };
    const out = fetchAndRenderReceipt(ARGS, deps);
    expect(out.code).toBe(0);
    expect(out.body ?? "").not.toMatch(/\]\(\s*javascript:/i);
    expect(out.body ?? "").not.toContain("full receipt:"); // the javascript: artifact url was dropped
  });
});

describe("renderReceiptPayload", () => {
  it("rejects malformed JSON without throwing", () => {
    expect(renderReceiptPayload("{not json").ok).toBe(false);
  });
  it("renders a valid payload", () => {
    const json = JSON.stringify({ schemaVersion: PR_RECEIPT_SCHEMA_VERSION, bodyInput: { contributors: [], excludedCount: 0 }, extras: {} });
    expect(renderReceiptPayload(json).ok).toBe(true);
  });

  it("rejects an old detail receipt with an exact-looking bare dollar", () => {
    const json = JSON.stringify({
      schemaVersion: PR_RECEIPT_SCHEMA_VERSION,
      bodyInput: { contributors: [], excludedCount: 0 },
      extras: { details: [{ label: "builder", row: [], text: "TOTAL................$1.23" }] },
    });
    const out = renderReceiptPayload(json);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toContain("regenerate the receipt ref");
    }
  });

  it("accepts qualified lower-bound/heuristic dollars but rejects truncated ones", () => {
    const payload = (text: string) =>
      JSON.stringify({
        schemaVersion: PR_RECEIPT_SCHEMA_VERSION,
        bodyInput: { contributors: [], excludedCount: 0 },
        extras: { details: [{ label: "builder", row: [], text }] },
      });
    expect(renderReceiptPayload(payload("TOTAL.............≥ $1.23\npattern...........≈ $0.50")).ok).toBe(true);
    expect(renderReceiptPayload(payload("TOTAL.............≥ $1,234,56…")).ok).toBe(false);
  });
});
