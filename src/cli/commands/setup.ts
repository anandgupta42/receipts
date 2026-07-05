import { buildSetupReport, setupReportToJson } from "../../setup/report.js";
import { renderSetupReport } from "../../setup/render.js";
import type { CommandContext, CommandDef } from "../types.js";
import { noSessionsMessage } from "../common/session.js";

async function run(ctx: CommandContext): Promise<number> {
  const report = await buildSetupReport(ctx.now());
  if (ctx.options.json) {
    ctx.stdout.write(`${JSON.stringify(setupReportToJson(report), null, 2)}\n`);
    return 0;
  }
  const noSessionText = report.status === "no_sessions" ? await noSessionsMessage() : undefined;
  ctx.stdout.write(`${renderSetupReport(report, noSessionText)}\n`);
  return 0;
}

export const command: CommandDef = {
  name: "setup",
  priority: 75,
  matches: (options) => options.positional[0] === "setup",
  run,
  help: {
    order: 15,
    lines: ["  aireceipts setup [--json]             first-run report and local integration next steps"],
  },
};
