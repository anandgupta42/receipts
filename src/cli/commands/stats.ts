// SPEC-0043 R7: `stats` prints local-only counters from ~/.aireceipts/state.json.
// The counters are a product feature, not telemetry payload fields.
import { readState } from "../../telemetry/index.js";
import type { CommandContext, CommandDef } from "../types.js";

function displayDate(firstRunAt: string | undefined): string {
  return firstRunAt ? firstRunAt.slice(0, 10) : "unknown";
}

async function run(ctx: CommandContext): Promise<number> {
  const state = await readState();
  const totalRuns = Math.max(0, state.runCount - 1);
  const firstRunAt = totalRuns === 0 && state.receiptCount === 0 ? "unknown" : displayDate(state.firstRunAt);
  if (ctx.options.json) {
    ctx.stdout.write(
      `${JSON.stringify(
        {
          receiptsGenerated: state.receiptCount,
          totalRuns,
          firstRunAt,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    ctx.stdout.write(
      [
        `receipts generated on this machine: ${state.receiptCount}`,
        `total runs: ${totalRuns}`,
        `first run: ${firstRunAt}`,
        "(counted locally in ~/.aireceipts/state.json — delete that file to reset; never leaves your machine)",
      ].join("\n") + "\n",
    );
  }
  return 0;
}

export const command: CommandDef = {
  name: "stats",
  priority: 65,
  matches: (options) => options.positional[0] === "stats",
  run,
  help: {
    order: 25,
    lines: ["  aireceipts stats                      local usage counters (receipts generated on this machine)"],
  },
};
