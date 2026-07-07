import type { AgentSource } from "../../parse/types.js";
import { isTemplateName } from "../../receipt/blocks.js";
import type { ReceiptModel } from "../../receipt/model.js";
import type { RecordReceiptGeneratedInput } from "../../telemetry/index.js";
import type { OutputModeValue, PricedRowCoverageValue, ReceiptSurfaceValue, TemplateTelemetryValue } from "../../telemetry/schemas.js";

function pricedRowCoverage(models: readonly ReceiptModel[]): PricedRowCoverageValue {
  if (models.every((model) => model.totalUsd === null)) {
    return "none";
  }
  const rows = models.flatMap((model) => model.toolRows);
  return rows.length > 0 && models.every((model) => model.totalUsd !== null) && rows.every((row) => row.usd !== null)
    ? "all"
    : "some";
}

function agentTypeFor(models: readonly ReceiptModel[]): AgentSource | undefined {
  const sources = new Set(models.map((model) => model.source));
  return sources.size === 1 ? models[0]?.source : undefined;
}

export function templateTelemetryValue(template: string | undefined): TemplateTelemetryValue {
  return template && isTemplateName(template) ? template : "none";
}

export function receiptTelemetryFromModels(input: {
  surface: ReceiptSurfaceValue;
  models: readonly ReceiptModel[];
  outputMode: OutputModeValue;
  template: TemplateTelemetryValue;
  turnCount: number;
  toolCallCount: number;
  /** SPEC-0054 R8 — true only when the render carried the `--details` section. */
  detailsView: boolean;
}): Omit<RecordReceiptGeneratedInput, "receiptOrdinal"> {
  const waste = input.models.flatMap((model) => model.wasteLines);
  return {
    surface: input.surface,
    agentType: agentTypeFor(input.models),
    multiAgent: input.models.length > 1,
    outputMode: input.outputMode,
    template: input.template,
    pricedRowCoverage: pricedRowCoverage(input.models),
    hasStuckLoopWaste: waste.some((line) => line.kind === "stuck-loop"),
    hasTrivialSpansWaste: waste.some((line) => line.kind === "trivial-spans"),
    hasContextThrashWaste: waste.some((line) => line.kind === "context-thrash"),
    hasPriceDelta: input.models.some((model) => model.priceDelta !== null),
    // SPEC-0061 R6 — boolean only, never a count (I4).
    hasSubagents: input.models.some((model) => model.subagents !== undefined),
    // SPEC-0067 R7 — true iff a pre-edit line actually rendered: it is classic-only
    // (default `none` or explicit `classic`), and only when a session has usage turns
    // to split. grocery/datavis omit the line, so they report false (Codex #6).
    hasPreEditShare:
      (input.template === "none" || input.template === "classic") &&
      input.models.some((model) => model.costShape.preEdit.totalTurnCount > 0),
    detailsView: input.detailsView,
    turnCount: input.turnCount,
    toolCallCount: input.toolCallCount,
  };
}
