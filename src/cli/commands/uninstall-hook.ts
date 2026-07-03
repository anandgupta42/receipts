// SPEC-0018: `uninstall-hook` — remove the SessionEnd auto-receipt hook.
// priority 100, matches the `uninstall-hook` positional subcommand.
import { uninstallHook } from "../../hook/install.js";
import type { CommandContext, CommandDef } from "../types.js";
import { hookIoFor } from "../common/output.js";

function run(ctx: CommandContext): Promise<number> {
  return uninstallHook(hookIoFor(ctx));
}

export const command: CommandDef = {
  name: "uninstall-hook",
  priority: 100,
  matches: (options) => options.positional[0] === "uninstall-hook",
  run,
  help: {
    order: 170,
    lines: ["  aireceipts uninstall-hook             remove that hook"],
  },
};
