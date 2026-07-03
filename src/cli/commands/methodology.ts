// SPEC-0018: `--methodology` — print the attribution methodology text. Hidden
// (no help entry) but parseable, exactly as before. priority 180, matches the
// `--methodology` flag.
import { METHODOLOGY } from "../../pricing/attribution.js";
import type { CommandContext, CommandDef } from "../types.js";

function run(ctx: CommandContext): number {
  ctx.stdout.write(`${METHODOLOGY}\n`);
  return 0;
}

export const command: CommandDef = {
  name: "methodology",
  priority: 180,
  matches: (options) => options.methodology,
  run,
};
