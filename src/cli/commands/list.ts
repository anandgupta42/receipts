// SPEC-0018: `--list` — sessions, newest first. priority 50 (below every
// positional subcommand, above the default receipt), matches the `--list` flag.
import { listFullSessions } from "../../index.js";
import type { SessionSummary } from "../../parse/types.js";
import { formatAbsoluteUtc, formatInt } from "../../receipt/format.js";
import { summaryToJson } from "../../receipt/json.js";
import type { CommandContext, CommandDef } from "../types.js";
import { noSessionsMessage } from "../common/session.js";

function listLine(index: number, summary: SessionSummary): string {
  const start = summary.startedAt !== undefined ? formatAbsoluteUtc(summary.startedAt) : "start time unknown";
  const label = summary.title ?? summary.id;
  return `${index + 1}. [${summary.source}] ${label}  ·  ${start}  ·  ${formatInt(summary.totals.toolCallCount)} tool calls`;
}

async function run(ctx: CommandContext): Promise<number> {
  const sessions = await listFullSessions();
  if (sessions.length === 0) {
    ctx.stdout.write(`${await noSessionsMessage()}\n`);
    return 0;
  }
  if (ctx.options.json) {
    ctx.stdout.write(`${JSON.stringify(sessions.map(summaryToJson), null, 2)}\n`);
  } else {
    ctx.stdout.write(`${sessions.map((s, i) => listLine(i, s)).join("\n")}\n`);
  }
  return 0;
}

export const command: CommandDef = {
  name: "list",
  priority: 50,
  matches: (options) => options.list,
  run,
  help: {
    order: 20,
    lines: ["  aireceipts --list [--json]            list sessions, newest first"],
  },
};
