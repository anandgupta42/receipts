import type { PrBodyExtras, PrBodyInput } from "./body.js";

/**
 * SPEC-0065 / SPEC-0066 — the versioned, JSON-plain PR-receipt payload stored at
 * `refs/receipts/<slug>` by the local producer and re-rendered by CI. It is exactly the
 * renderer's input (`renderPrBody(bodyInput, extras)`), so a round-trip reproduces the
 * comment byte-for-byte. Bump `PR_RECEIPT_SCHEMA_VERSION` on any INCOMPATIBLE shape change
 * (renamed/removed field, changed type/meaning). A purely additive OPTIONAL field whose
 * absent value reproduces prior behavior is backward-compatible — an older ref still
 * validates and re-renders identically — and does NOT require a bump (SPEC-0070's
 * `extras.samosa`, which defaults to off, is such a field).
 *
 * This file is the SEAM the producer (SPEC-0065) and the CI consumer (SPEC-0066) both
 * build against — it holds only the shared type, version, and slug so the two sides never
 * drift. Serialization lives with the producer; validation/sanitization lives with CI.
 */
export const PR_RECEIPT_SCHEMA_VERSION = 1 as const;

export interface PrReceiptPayload {
  schemaVersion: number;
  bodyInput: PrBodyInput;
  extras: PrBodyExtras;
}

/**
 * The ref slug for a branch (`refs/receipts/<slug>`). Shared verbatim by the producer's
 * write path and CI's fetch path so they never diverge. Deterministic and ref-safe: every
 * character outside `[A-Za-z0-9._-]` collapses to `-`.
 */
export function receiptRefSlug(branch: string): string {
  return branch.replace(/[^A-Za-z0-9._-]/g, "-");
}
