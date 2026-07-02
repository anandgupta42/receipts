// SPEC-0018: `benchmark` — opt-in cost-per-turn benchmark (SPEC-0015 v1: client
// contract only, sends disabled). priority 130, matches the `benchmark`
// positional subcommand. selector is positional[1].
import { loadSession } from "../../index.js";
import { buildReceiptModel } from "../../receipt/model.js";
import { buildBenchmarkPayload, confirmPrompt, BENCHMARK_UNAVAILABLE_MESSAGE } from "../../benchmark/index.js";
import type { CommandContext, CommandDef } from "../types.js";
import { resolveSelector } from "../common/session.js";

async function run(ctx: CommandContext): Promise<number> {
  const { options } = ctx;
  const resolved = await resolveSelector(options.positional[1]);
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
  const payload = buildBenchmarkPayload(model, session.totals.turnCount);

  if (options.dryRun) {
    ctx.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  const consented = await confirmPrompt("Send anonymous benchmark data for this session?", ctx.stdin, ctx.stdout);
  if (!consented) {
    return 0;
  }

  ctx.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  ctx.stdout.write(`${BENCHMARK_UNAVAILABLE_MESSAGE}\n`);
  return 0;
}

export const command: CommandDef = {
  name: "benchmark",
  priority: 130,
  matches: (options) => options.positional[0] === "benchmark",
  run,
  help: {
    order: 120,
    lines: [
      "  aireceipts benchmark [--dry-run]      opt-in cost-per-turn benchmark (v1: client",
      "                                         contract only, sends disabled)",
    ],
  },
};
