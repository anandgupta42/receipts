// SPEC-0018: `--version` / `-v` — print the installed CLI version and exit.
// priority 185: below `--help` (190) so `--help` wins when both are passed, but
// above every other command-selecting flag (methodology=180 and down) so
// `--version` short-circuits any receipt/session work.
import { getCliVersion } from "../../telemetry/helpers.js";
import type { CommandContext, CommandDef } from "../types.js";

function run(ctx: CommandContext): number {
  ctx.stdout.write(`${getCliVersion()}\n`);
  return 0;
}

export const command: CommandDef = {
  name: "version",
  priority: 185,
  matches: (options) => options.version,
  run,
  help: {
    order: 200,
    lines: ["  aireceipts --version                  print the installed version"],
  },
};
