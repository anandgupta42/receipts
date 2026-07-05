// SPEC-0018: `week` — trailing-7-day digest across sessions. priority 70, matches
// the `week` positional subcommand.
import { buildWeekDigest } from "../../aggregate/week.js";
import { renderWeek, weekToJson } from "../../receipt/week.js";
import type { CommandContext, CommandDef } from "../types.js";

async function run(ctx: CommandContext): Promise<number> {
  const { options } = ctx;
  let sinceMs: number | undefined;
  if (options.since !== undefined) {
    const parsed = Date.parse(options.since);
    if (Number.isNaN(parsed)) {
      ctx.stderr.write(`invalid --since date: "${options.since}"\n`);
      return 1;
    }
    sinceMs = parsed;
  }
  const digest = await buildWeekDigest({ sinceMs, byProject: options.byProject });
  if (options.json) {
    ctx.stdout.write(`${JSON.stringify(weekToJson(digest), null, 2)}\n`);
    ctx.telemetry.recordExportGenerated({ surface: "week", format: "json", wroteFile: false, result: "success" });
  } else {
    ctx.stdout.write(`${renderWeek(digest)}\n`);
  }
  await ctx.telemetry.noteMilestone("first_week", "week");
  return 0;
}

export const command: CommandDef = {
  name: "week",
  priority: 70,
  matches: (options) => options.positional[0] === "week",
  run,
  help: {
    order: 90,
    lines: [
      "  aireceipts week [--by-project] [--since <date>] [--json]",
      "                                        trailing-7-day digest across sessions",
    ],
  },
};
