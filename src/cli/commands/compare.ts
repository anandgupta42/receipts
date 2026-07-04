// SPEC-0018: `compare <a> <b>` — side-by-side (or stacked) comparison. priority
// 140, matches the `compare` positional subcommand. compareA/compareB are
// positional[1]/positional[2] (positional[0] is the literal "compare").
import { listFullSessions, loadSession, selectSummary } from "../../index.js";
import { renderCompare, compareDeltaLine } from "../../receipt/compare.js";
import { toCompareCsv } from "../../receipt/csv.js";
import { toCompareJsonModel } from "../../receipt/json.js";
import { buildReceiptModel } from "../../receipt/model.js";
import { renderCompareSvg } from "../../receipt/svg.js";
import type { CommandContext, CommandDef } from "../types.js";
import { noSessionsMessage } from "../common/session.js";
import { svgOutOf, writeSvg } from "../common/output.js";
import { receiptTelemetryFromModels } from "../common/telemetry.js";
import type { ExportFormatValue, OutputModeValue } from "../../telemetry/schemas.js";

async function recordCompareTelemetry(
  ctx: CommandContext,
  models: Parameters<typeof receiptTelemetryFromModels>[0]["models"],
  totals: { turnCount: number; toolCallCount: number },
  outputMode: OutputModeValue,
): Promise<void> {
  await ctx.telemetry.noteReceiptGenerated(
    receiptTelemetryFromModels({
      surface: "compare",
      models,
      outputMode,
      template: "none",
      turnCount: totals.turnCount,
      toolCallCount: totals.toolCallCount,
    }),
    "compare",
  );
  await ctx.telemetry.noteMilestone("first_compare", "compare");
}

async function recordCompareExport(ctx: CommandContext, format: ExportFormatValue, wroteFile: boolean): Promise<void> {
  ctx.telemetry.recordExportGenerated({ surface: "compare", format, wroteFile, result: "success" });
  await ctx.telemetry.noteMilestone("first_export", "compare");
}

async function run(ctx: CommandContext): Promise<number> {
  const { options } = ctx;
  const selectorA = options.positional[1];
  const selectorB = options.positional[2];
  if (!selectorA || !selectorB) {
    ctx.stderr.write("compare requires two selectors: aireceipts compare <a> <b>\n");
    return 1;
  }
  // compare CSV is strictly two session rows + a delta (R3) — per-tool granularity has no two-row shape here.
  if (options.csvMode !== undefined && options.csvMode !== "session") {
    ctx.stderr.write(`compare supports --csv=session only (got "${options.csvMode}")\n`);
    return 1;
  }
  const svgOut = svgOutOf(options);
  // SPEC-0012 R5: compare --png is deferred (doubles the blast radius of a new
  // native dependency) — checked before any session lookup, same as csvMode above.
  if (svgOut.png) {
    ctx.stderr.write("compare --png is not supported yet — use compare --svg\n");
    return 1;
  }
  const sessions = await listFullSessions();
  if (sessions.length === 0) {
    ctx.stderr.write(`${await noSessionsMessage()}\n`);
    return 1;
  }
  const summaryA = selectSummary(sessions, selectorA);
  const summaryB = selectSummary(sessions, selectorB);
  if (!summaryA) {
    ctx.stderr.write(`no session matched "${selectorA}"\n`);
    return 1;
  }
  if (!summaryB) {
    ctx.stderr.write(`no session matched "${selectorB}"\n`);
    return 1;
  }
  const [sessionA, sessionB] = await Promise.all([loadSession(summaryA), loadSession(summaryB)]);
  if (!sessionA || !sessionB) {
    ctx.stderr.write("failed to load one or both sessions\n");
    return 1;
  }
  const [modelA, modelB] = await Promise.all([buildReceiptModel(sessionA), buildReceiptModel(sessionB)]);
  const totals = {
    turnCount: sessionA.totals.turnCount + sessionB.totals.turnCount,
    toolCallCount: sessionA.totals.toolCallCount + sessionB.totals.toolCallCount,
  };
  if (svgOut.svg) {
    await writeSvg(ctx, renderCompareSvg(modelA, modelB, { theme: svgOut.theme }), svgOut.output ?? "compare.svg");
    await recordCompareTelemetry(ctx, [modelA, modelB], totals, "svg");
    await recordCompareExport(ctx, "svg", true);
  } else if (options.csvMode !== undefined) {
    ctx.stdout.write(`${toCompareCsv(modelA, modelB, compareDeltaLine(modelA, modelB))}\n`);
    await recordCompareTelemetry(ctx, [modelA, modelB], totals, "csv");
    await recordCompareExport(ctx, "csv_session", false);
  } else if (options.json) {
    ctx.stdout.write(`${JSON.stringify(toCompareJsonModel(modelA, modelB), null, 2)}\n`);
    await recordCompareTelemetry(ctx, [modelA, modelB], totals, "json");
    await recordCompareExport(ctx, "json", false);
  } else {
    ctx.stdout.write(`${renderCompare(modelA, modelB)}\n`);
    await recordCompareTelemetry(ctx, [modelA, modelB], totals, "text");
  }
  return 0;
}

export const command: CommandDef = {
  name: "compare",
  priority: 140,
  matches: (options) => options.positional[0] === "compare",
  run,
  help: {
    order: 30,
    lines: ["  aireceipts compare <a> <b> [--json|--csv]  side-by-side (or stacked) comparison"],
  },
};
