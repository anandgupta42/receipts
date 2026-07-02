// SPEC-0018: `--handoff` — paste-ready block of fired waste lines, plus standing
// -rule suggestions for waste classes recurring across recent sessions. priority
// 40 (above the default receipt, below every subcommand), matches `--handoff`.
import { loadSession } from "../../index.js";
import type { Session } from "../../parse/types.js";
import { DEFAULT_HANDOFF_THRESHOLD, renderHandoff, standingRuleSuggestions } from "../../receipt/handoff.js";
import { buildReceiptModel } from "../../receipt/model.js";
import { partitionWindows, windowBounds } from "../../aggregate/week.js";
import { aggregateWaste, type WasteClassAggregate } from "../../aggregate/waste.js";
import { listFullSessions } from "../../index.js";
import type { CommandContext, CommandDef } from "../types.js";
import { resolveSelector } from "../common/session.js";

/**
 * SPEC-0013 R1: aggregate waste across the trailing-7-day window (SPEC-0008's
 * window definition, reused so there's one notion of "recent"). Feeds the
 * distinct-session recurrence check for standing-rule suggestions. Re-exported
 * from `src/cli/index.js` for the existing handoff-recent test.
 */
export async function recentWasteAggregates(now: number = Date.now()): Promise<WasteClassAggregate[]> {
  const bounds = windowBounds(now);
  const summaries = await listFullSessions();
  const { current } = partitionWindows(summaries, bounds);
  const loaded = await Promise.all(current.map((s) => loadSession(s)));
  return aggregateWaste(loaded.filter((s): s is Session => s !== null));
}

async function run(ctx: CommandContext): Promise<number> {
  const { options } = ctx;
  const threshold = options.handoffThreshold ?? DEFAULT_HANDOFF_THRESHOLD;
  if (options.handoffThreshold !== undefined && (!Number.isInteger(threshold) || threshold < 1)) {
    ctx.stderr.write("invalid --handoff-threshold (expected a positive integer)\n");
    return 1;
  }
  const resolved = await resolveSelector(options.positional[0]);
  if ("error" in resolved) {
    ctx.stderr.write(`${resolved.error}\n`);
    return 1;
  }
  const session = await loadSession(resolved.summary);
  if (!session) {
    ctx.stderr.write(`failed to load session "${resolved.summary.id}"\n`);
    return 1;
  }
  const model = await buildReceiptModel(session);
  const suggestions = standingRuleSuggestions(await recentWasteAggregates(ctx.now()), threshold);
  ctx.stdout.write(`${renderHandoff(model, suggestions)}\n`);
  return 0;
}

export const command: CommandDef = {
  name: "handoff",
  priority: 40,
  matches: (options) => options.handoff,
  run,
  help: {
    order: 40,
    lines: [
      "  aireceipts --handoff [selector] [--handoff-threshold N]",
      "                                        paste-ready block of fired waste lines;",
      "                                         suggests CLAUDE.md rules for waste classes",
      "                                         recurring in N+ recent sessions (default 3)",
    ],
  },
};
