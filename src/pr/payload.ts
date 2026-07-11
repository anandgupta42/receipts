// SPEC-0065 R1 — assembly + serialization for the `PrReceiptPayload` stored
// on a receipt ref. `payloadTypes.ts` is the shared seam (type, version,
// slug helper) both this producer and SPEC-0066's CI consumer build
// against; validation/deserialization of the untrusted ref bytes is CI's
// job (payloadTypes.ts's own header comment), not this file's.
import type { ReceiptModel } from "../receipt/model.js";
import type { PrBodyExtras, PrBodyInput } from "./body.js";
import { PR_RECEIPT_SCHEMA_VERSION, type PrReceiptPayload } from "./payloadTypes.js";

/**
 * SPEC-0077 R2a — the payload is defined as EXACTLY the renderer's input, and
 * the renderer never reads a subagent's `modelMix`/`toolRows`/`partialPriced`
 * (those exist only to feed `buildPrCardModel`). Drop them so the stored ref
 * bytes stay identical to a pre-card ref and pass SPEC-0066's strict
 * (`.strict()`) validator, which rejects unknown keys on `SubagentRow`. Clones
 * only — the caller's `bodyInput` (still feeding the live card build) is never
 * mutated.
 */
function stripCardOnlyFields(bodyInput: PrBodyInput): PrBodyInput {
  return {
    ...bodyInput,
    contributors: bodyInput.contributors.map((c) => ({
      ...c,
      subagents: c.subagents.map((s) => {
        const row = { ...s };
        delete row.modelMix;
        delete row.toolRows;
        delete row.partialPriced;
        return row;
      }),
    })),
  };
}

/**
 * Assemble the schema-versioned payload stored on the receipt ref — exactly
 * the renderer's own input (`bodyInput`/`extras`), so reading it back and
 * feeding it to `renderPrBody` reproduces the comment byte-for-byte.
 */
export function buildPrReceiptPayload(bodyInput: PrBodyInput, extras: PrBodyExtras): PrReceiptPayload {
  return {
    schemaVersion: PR_RECEIPT_SCHEMA_VERSION,
    bodyInput: stripCardOnlyFields(bodyInput),
    extras,
  };
}

/**
 * Deterministic JSON for a `PrReceiptPayload` — the exact bytes written to
 * `receipt.json` on the receipt ref. Rebuilds the object in a fixed key
 * order (`schemaVersion`, `bodyInput`, `extras`) rather than trusting the
 * caller's own insertion order, so the same payload always serializes to
 * the same bytes (SPEC-0065 R1/R6).
 */
export function serializePrReceipt(payload: PrReceiptPayload): string {
  return JSON.stringify({
    schemaVersion: payload.schemaVersion,
    bodyInput: payload.bodyInput,
    extras: payload.extras,
  });
}

/**
 * The receipt ref's commit date: `max(startedAtMs + durationMs)` across
 * every contributing session's model, never wall-clock, so the same
 * transcript always yields the same date (and therefore the same commit
 * SHA). A model missing either field doesn't contribute; if none carry
 * both, returns 0 rather than falling back to `Date.now()`.
 */
export function canonicalEndedAtMs(models: readonly ReceiptModel[]): number {
  let max = 0;
  for (const model of models) {
    if (model.startedAtMs === undefined || model.durationMs === undefined) {
      continue;
    }
    const ended = model.startedAtMs + model.durationMs;
    if (ended > max) {
      max = ended;
    }
  }
  return max;
}
