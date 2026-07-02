// SPEC-0018: `install-hook` — add a Claude Code SessionEnd auto-receipt hook.
// priority 110, matches the `install-hook` positional subcommand. The prompt/
// filesystem seams (R3) come from the context via `hookIoFor`.
import { installHook } from "../../hook/install.js";
import type { CommandContext, CommandDef } from "../types.js";
import { hookIoFor } from "../common/output.js";

function run(ctx: CommandContext): Promise<number> {
  return installHook(hookIoFor(ctx));
}

export const command: CommandDef = {
  name: "install-hook",
  priority: 110,
  matches: (options) => options.positional[0] === "install-hook",
  run,
  help: {
    order: 160,
    lines: ["  aireceipts install-hook               add a Claude Code SessionEnd auto-receipt hook"],
  },
};
