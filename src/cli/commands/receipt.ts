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

const CSV_MODE_HINT = "use --csv=session or --csv=tool";

async function run(ctx: CommandContext): Promise<number> {
  const { options } = ctx;
  const resolvedTemplate = resolveTemplate(options.template);
  if ("error" in resolvedTemplate) {
    ctx.stderr.write(`${resolvedTemplate.error}\n`);
    return 1;
  }
  const template = resolvedTemplate.template;
  const resolved = await resolveSelector(options.positional[0]);
  if ("error" in resolved) {
    ctx.stderr.write(`${resolved.error}\n`);
    return 1;
  }
  const session = await loadSession(resolved.summary);
  if (!session) {
    ctx.stderr.write(`failed to load session "${resolved.summary.id}"\n`);
    return 1;
  }
  const model = await buildReceiptModel(session);
  const svgOut = svgOutOf(options);
  if (svgOut.svg) {
    await writeSvg(ctx, renderReceiptSvg(model, { theme: svgOut.theme, template }), svgOut.output ?? "receipt.svg");
    return 0;
  }
  if (svgOut.png) {
    const svg = renderReceiptSvg(model, { theme: svgOut.theme, template });
    await writePng(ctx, rasterizeSvgToPng(svg), svgOut.output ?? "receipt.png");
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
  } else {
    const budgetSuffix = budget.lines.length > 0 ? `\n\n${budget.lines.join("\n")}` : "";
    ctx.stdout.write(`${renderReceipt(model, { template })}${budgetSuffix}\n`);
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
