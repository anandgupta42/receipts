// SPEC-0018: `templates` — list the receipt templates, each with a 6-line live
// preview rendered from the built-in fixture model (SPEC-0020 R2). priority 80,
// matches the `templates` positional subcommand. The preview window starts at the
// body (past the shared masthead/meta header) so each preview shows what makes
// the template distinct.
import { TEMPLATE_NAMES } from "../../receipt/blocks.js";
import { previewModel } from "../../receipt/preview.js";
import { renderReceipt } from "../../receipt/render.js";
import type { CommandContext, CommandDef } from "../types.js";

function run(ctx: CommandContext): number {
  const model = previewModel();
  const blocks = TEMPLATE_NAMES.map((template) => {
    const lines = renderReceipt(model, { color: false, template }).split("\n");
    const firstBlank = lines.indexOf("");
    const start = firstBlank >= 0 ? firstBlank + 1 : 1;
    const preview = lines.slice(start, start + 6).join("\n");
    const suffix = template === "classic" ? "  (default)" : "";
    return `── ${template}${suffix} ──\n${preview}`;
  });
  ctx.stdout.write(`${blocks.join("\n\n")}\n`);
  return 0;
}

export const command: CommandDef = {
  name: "templates",
  priority: 80,
  matches: (options) => options.positional[0] === "templates",
  run,
  help: {
    order: 140,
    lines: ["  aireceipts templates                  list the templates with a live preview of each"],
  },
};
