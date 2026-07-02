// SPEC-0018: `--help` — the curated help layout, assembled from every command's
// help entry via the context's registry-driven renderer. priority 190 (highest),
// so `--help` wins over every other selector, exactly as the old parser did.
import type { CommandContext, CommandDef } from "../types.js";

function run(ctx: CommandContext): number {
  ctx.stdout.write(`${ctx.renderHelp()}\n`);
  return 0;
}

export const command: CommandDef = {
  name: "help",
  priority: 190,
  matches: (options) => options.help,
  run,
  help: {
    order: 190,
    lines: ["  aireceipts --help                     show this help"],
  },
};
