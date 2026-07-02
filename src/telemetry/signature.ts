import { createHash } from "node:crypto";

/**
 * SHA-256 hex digest of a structural shape descriptor (R2's `signatureHash`
 * on `parse_failure`). `shape` must already be a content-free description
 * of *where* parsing broke (e.g. `"claude-code:turn.usage.missing"`) — this
 * function only hashes what it's given; keeping transcript content out of
 * `shape` is the caller's responsibility (see `telemetry/index.ts`'s
 * `recordParseFailure`, the only caller). Deterministic (I1): same shape
 * always hashes to the same digest.
 */
export function hashSignature(shape: string): string {
  return createHash("sha256").update(shape, "utf8").digest("hex");
}
