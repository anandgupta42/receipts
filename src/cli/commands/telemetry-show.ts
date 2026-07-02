// SPEC-0018: `--telemetry-show` — print the exact diagnostics payload a run would
// send (SPEC-0002 I4). Hidden (no help entry) but parseable. priority 170,
// matches the `--telemetry-show` flag. main() skips the first-run notice only for
// this command (R6); the payload comes through the context's telemetry seam.
import type { CommandContext, CommandDef } from "../types.js";

function run(ctx: CommandContext): number {
  ctx.stdout.write(`${JSON.stringify(ctx.telemetry.showPayload(ctx.env), null, 2)}\n`);
  return 0;
}

export const command: CommandDef = {
  name: "telemetry-show",
  priority: 170,
  matches: (options) => options.telemetryShow,
  run,
};
