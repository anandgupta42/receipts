// SPEC-0018: the default command — print a receipt for the selected session.
// Selection precedence: priority 0 (lowest), matches always, so it is the
// fallthrough when no other command's selector fires (byte-identical to the old
// parser's final `return { command: "receipt" }`).
import { loadSession } from "../../index.js";
import { evaluateBudget } from "../../budget/index.js";
import { getExporter } from "../../receipt/exporters.js";
import { buildReceiptModel } from "../../receipt/model.js";
import { renderReceipt } from "../../receipt/render.js";
import { renderReceiptSvg } from "../../receipt/svg.js";
import { rasterizeSvgToPng } from "../../receipt/png.js";
import { toJsonModel } from "../../receipt/json.js";
import type { CommandContext, CommandDef } from "../types.js";
import { resolveSelector, resolveTemplate } from "../common/session.js";
import { svgOutOf, writeSvg, writePng } from "../common/output.js";
import { receiptTelemetryFromModels, templateTelemetryValue } from "../common/telemetry.js";
import type { ExportFormatValue } from "../../telemetry/schemas.js";

const CSV_MODE_HINT = "use --csv=session or --csv=tool";

async function recordReceiptExport(ctx: CommandContext, format: ExportFormatValue, wroteFile: boolean): Promise<void> {
  ctx.telemetry.recordExportGenerated({ surface: "receipt", format, wroteFile, result: "success" });
  await ctx.telemetry.noteMilestone("first_export", "receipt");
}

async function run(ctx: CommandContext): Promise<number> {
  const { options } = ctx;
  const resolvedTemplate = resolveTemplate(options.template);
  if ("error" in resolvedTemplate) {
    ctx.stderr.write(`${resolvedTemplate.error}\n`);
    return 1;
  }
  const template = resolvedTemplate.template;
  // SPEC-0054 R6 — the DETAILS section is designed for classic's layout only.
  if (options.details && template !== "classic") {
    ctx.stderr.write("--details supports the classic template only\n");
    return 1;
  }
  const resolved = await resolveSelector(options.positional[0]);
  if ("error" in resolved) {
    ctx.stderr.write(`${resolved.error}\n`);
    return 1;
  }
  // SPEC-0045 R3 — the no-selector default already loaded a readable session
  // (skipping any unreadable newest); reuse it, no second parse.
  const session = resolved.session ?? (await loadSession(resolved.summary));
  if (!session) {
    ctx.stderr.write(`failed to load session "${resolved.summary.id}"\n`);
    return 1;
  }
  const model = await buildReceiptModel(session);
  const svgOut = svgOutOf(options);
  if (svgOut.svg) {
    await writeSvg(ctx, renderReceiptSvg(model, { theme: svgOut.theme, template, details: options.details }), svgOut.output ?? "receipt.svg");
    await ctx.telemetry.noteReceiptGenerated(
      receiptTelemetryFromModels({
        surface: "receipt",
        models: [model],
        outputMode: "svg",
        template: templateTelemetryValue(options.template),
        turnCount: session.totals.turnCount,
        toolCallCount: session.totals.toolCallCount,
        detailsView: options.details,
      }),
      "receipt",
    );
    await recordReceiptExport(ctx, "svg", true);
    return 0;
  }
  if (svgOut.png) {
    const svg = renderReceiptSvg(model, { theme: svgOut.theme, template, details: options.details });
    await writePng(ctx, rasterizeSvgToPng(svg), svgOut.output ?? "receipt.png");
    await ctx.telemetry.noteReceiptGenerated(
      receiptTelemetryFromModels({
        surface: "receipt",
        models: [model],
        outputMode: "png",
        template: templateTelemetryValue(options.template),
        turnCount: session.totals.turnCount,
        toolCallCount: session.totals.toolCallCount,
        detailsView: options.details,
      }),
      "receipt",
    );
    await recordReceiptExport(ctx, "png", true);
    return 0;
  }
  if (options.csvMode !== undefined) {
    const exporter = getExporter(`csv-${options.csvMode}`);
    if (!exporter) {
      ctx.stderr.write(`unknown --csv mode "${options.csvMode}" (${CSV_MODE_HINT})\n`);
      return 1;
    }
    // CSV is a data contract — budget advisory lines never ride along (SPEC-0009 x SPEC-0011).
    ctx.stdout.write(`${exporter.export(model)}\n`);
    await ctx.telemetry.noteReceiptGenerated(
      receiptTelemetryFromModels({
        surface: "receipt",
        models: [model],
        outputMode: "csv",
        template: templateTelemetryValue(options.template),
        turnCount: session.totals.turnCount,
        toolCallCount: session.totals.toolCallCount,
        // CSV never renders the DETAILS section — the flag is inert here (R7/R8).
        detailsView: false,
      }),
      "receipt",
    );
    await recordReceiptExport(ctx, options.csvMode === "tool" ? "csv_tool" : "csv_session", false);
    return 0;
  }
  // R1/R5: absent or malformed budget.json → `lines` is [] → output below is
  // byte-identical to pre-SPEC-0009 (goldens gate this). Malformed only adds
  // a stderr note, never a rendered line.
  const budget = await evaluateBudget(ctx.now());
  if (budget.status === "invalid") {
    ctx.stderr.write(`budget.json ignored: ${budget.invalidReason}\n`);
  }
  if (options.json) {
    const jsonModel = toJsonModel(model);
    const withBudget = budget.lines.length > 0 ? { ...jsonModel, budget: budget.lines } : jsonModel;
    ctx.stdout.write(`${JSON.stringify(withBudget, null, 2)}\n`);
    await ctx.telemetry.noteReceiptGenerated(
      receiptTelemetryFromModels({
        surface: "receipt",
        models: [model],
        outputMode: "json",
        template: templateTelemetryValue(options.template),
        turnCount: session.totals.turnCount,
        toolCallCount: session.totals.toolCallCount,
        // JSON never renders the DETAILS section — the flag is inert here (R7/R8).
        detailsView: false,
      }),
      "receipt",
    );
    await recordReceiptExport(ctx, "json", false);
  } else {
    const budgetSuffix = budget.lines.length > 0 ? `\n\n${budget.lines.join("\n")}` : "";
    ctx.stdout.write(`${renderReceipt(model, { template, details: options.details })}${budgetSuffix}\n`);
    await ctx.telemetry.noteReceiptGenerated(
      receiptTelemetryFromModels({
        surface: "receipt",
        models: [model],
        outputMode: "text",
        template: templateTelemetryValue(options.template),
        turnCount: session.totals.turnCount,
        toolCallCount: session.totals.toolCallCount,
        detailsView: options.details,
      }),
      "receipt",
    );
  }
  return 0;
}

export const command: CommandDef = {
  name: "receipt",
  priority: 0,
  matches: () => true,
  run,
  help: {
    order: 10,
    lines: ["  aireceipts [selector] [--json|--csv]  print a receipt (default: newest session)"],
  },
};
