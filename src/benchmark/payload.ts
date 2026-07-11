import type { AgentSource } from "../parse/types.js";
import { vendorForSource } from "../pricing/resolve.js";
import { combinedPricedUsd, type ReceiptModel } from "../receipt/model.js";
import type { BenchmarkAgentTypeValue, BenchmarkRunEvent, CostPerTurnBucketValue, ModelFamilyValue } from "./schemas.js";

/**
 * Derives SPEC-0015's coarse benchmark buckets from a `ReceiptModel` (R2).
 * `turnCount` is passed separately rather than importing `Session` here —
 * it lives on `Session.totals.turnCount`, not on `ReceiptModel` — keeping
 * this module's dependency surface to exactly the fields it buckets.
 */

export function toBenchmarkAgentType(source: AgentSource | undefined): BenchmarkAgentTypeValue {
  if (source === "claude-code" || source === "codex" || source === "cursor" || source === "opencode") {
    return source;
  }
  return "unknown";
}

/** Reuses the pricing layer's vendor mapping so a raw model ID string never has to be parsed or touched here. */
export function toModelFamily(source: AgentSource): ModelFamilyValue {
  const vendor = vendorForSource(source);
  return vendor === "anthropic" || vendor === "openai" ? vendor : "unknown";
}

/** `null`/non-finite/zero-turn sessions bucket to "unpriced" rather than dividing by zero or leaking a raw total. */
export function bucketCostPerTurn(totalUsd: number | null, turnCount: number): CostPerTurnBucketValue {
  if (totalUsd === null || !Number.isFinite(totalUsd) || turnCount <= 0) {
    return "unpriced";
  }
  const perTurn = totalUsd / turnCount;
  if (perTurn < 0.01) {
    return "<$0.01";
  }
  if (perTurn < 0.05) {
    return "$0.01-$0.05";
  }
  if (perTurn < 0.25) {
    return "$0.05-$0.25";
  }
  if (perTurn < 1) {
    return "$0.25-$1";
  }
  return ">$1";
}

/** The two existing `WasteLine` kinds (src/receipt/model.ts) map directly onto R2's two waste-class booleans — no new taxonomy needed. */
function hasWasteKind(model: ReceiptModel, kind: "stuck-loop" | "trivial-spans"): boolean {
  return model.wasteLines.some((line) => line.kind === kind);
}

export function buildBenchmarkPayload(model: ReceiptModel, turnCount: number): BenchmarkRunEvent {
  // A benchmark turn is a top-level orchestration turn. Its cost bucket covers
  // the parent plus readable child work that turn delegated; an unpriced parent
  // remains unpriced under the receipt's one-unit display contract.
  const fullSessionUsd = model.totalUsd !== null ? combinedPricedUsd(model) : null;
  return {
    name: "benchmark_run",
    properties: {
      agentType: toBenchmarkAgentType(model.source),
      modelFamily: toModelFamily(model.source),
      costPerTurnBucket: bucketCostPerTurn(fullSessionUsd, turnCount),
      hasStuckLoopWaste: hasWasteKind(model, "stuck-loop"),
      hasTrivialSpanWaste: hasWasteKind(model, "trivial-spans"),
    },
  };
}
