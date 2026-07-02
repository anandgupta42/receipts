// SPEC-0018: `--quota` — current Claude Code rate-limit window usage, rendered
// from the statusline stdin payload (SPEC-0014). priority 150, matches the
// `--quota` flag. Rendering lives in `src/cli/quota.js` (its own tested seam);
// this module only wires the command to the context's stdin.
import { runQuota } from "../quota.js";
import type { CommandContext, CommandDef } from "../types.js";

function run(ctx: CommandContext): Promise<number> {
  return runQuota(ctx.stdin, (s) => ctx.stdout.write(s));
}

export const command: CommandDef = {
  name: "quota",
  priority: 150,
  matches: (options) => options.quota,
  run,
  help: {
    order: 50,
    lines: [
      "  aireceipts --quota                    current Claude Code rate-limit window usage",
      "                                         (statusline stdin mode only; silent if unavailable)",
    ],
  },
};
