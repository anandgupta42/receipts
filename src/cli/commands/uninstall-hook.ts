// SPEC-0018: `uninstall-hook` — remove the SessionEnd auto-receipt hook.
// priority 100, matches the `uninstall-hook` positional subcommand.
import { uninstallHook } from "../../hook/install.js";
import type { CommandContext, CommandDef } from "../types.js";
import { hookIoFor } from "../common/output.js";
import type { ResultValue } from "../../telemetry/schemas.js";

async function run(ctx: CommandContext): Promise<number> {
  try {
    const code = await uninstallHook(hookIoFor(ctx));
    const result: ResultValue = code === 0 ? "success" : "internal_error";
    ctx.telemetry.recordHookConfigured({ operation: "uninstall", promptOutcome: "not_prompted", result });
    return code;
  } catch (err) {
    ctx.telemetry.recordHookConfigured({ operation: "uninstall", promptOutcome: "not_prompted", result: "write_failed" });
    throw err;
  }
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
