// SPEC-0018: `install-hook` — add a Claude Code SessionEnd auto-receipt hook.
// priority 110, matches the `install-hook` positional subcommand. The prompt/
// filesystem seams (R3) come from the context via `hookIoFor`.
import { installHook } from "../../hook/install.js";
import type { CommandContext, CommandDef } from "../types.js";
import type { PromptOutcomeValue, ResultValue } from "../../telemetry/schemas.js";

async function run(ctx: CommandContext): Promise<number> {
  let promptOutcome: PromptOutcomeValue = "not_prompted";
  let declined = false;
  try {
    const code = await installHook({
      confirm: async (question) => {
        const accepted = await ctx.prompt(question);
        promptOutcome = accepted ? "accepted" : "declined";
        declined = !accepted;
        return accepted;
      },
      out: (s) => ctx.stdout.write(`${s}\n`),
      err: (s) => ctx.stderr.write(`${s}\n`),
    });
    const result: ResultValue = code === 0 ? (declined ? "declined" : "success") : "internal_error";
    ctx.telemetry.recordHookConfigured({ operation: "install", promptOutcome, result });
    if (result === "success") {
      await ctx.telemetry.noteMilestone("first_hook_install", "install-hook");
    }
    return code;
  } catch (err) {
    ctx.telemetry.recordHookConfigured({ operation: "install", promptOutcome, result: "write_failed" });
    throw err;
  }
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
