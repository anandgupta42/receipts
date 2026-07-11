// SPEC-0018: `--mini` (SPEC-0006 R4) — the newest session's 6-line receipt,
// invoked by the SessionEnd hook. priority 120, matches the `--mini` flag.
// Fail-safe (R6): any error is swallowed and the process still exits 0 so it can
// never block or fail Claude Code's own shutdown.
import { loadSession } from "../../index.js";
import { buildFullSessionReceiptModel } from "../../receipt/subagents.js";
import { renderMiniReceipt } from "../../receipt/mini.js";
import type { CommandContext, CommandDef } from "../types.js";
import { resolveSelector } from "../common/session.js";
import { receiptTelemetryFromModels } from "../common/telemetry.js";

async function run(ctx: CommandContext): Promise<number> {
  try {
    const resolved = await resolveSelector(ctx.options.positional[0]);
    if ("error" in resolved) {
      ctx.stderr.write(`${resolved.error}\n`);
      return 0;
    }
    const session = await loadSession(resolved.summary);
    if (!session) {
      return 0;
    }
    // SPEC-0061 R4 — subagent rollup; attach is itself fail-safe (parent-only on error).
    const model = await buildFullSessionReceiptModel(session);
    ctx.stdout.write(`${renderMiniReceipt(model)}\n`);
    await ctx.telemetry.noteReceiptGenerated(
      receiptTelemetryFromModels({
        surface: "mini",
        models: [model],
        outputMode: "text",
        template: "none",
        turnCount: session.totals.turnCount,
        toolCallCount: session.totals.toolCallCount,
        detailsView: false,
      }),
      "mini",
    );
  } catch {
    // Fire-and-forget: a mini-receipt failure must never surface as a hook error.
  }
  return 0;
}

export const command: CommandDef = {
  name: "mini",
  priority: 120,
  matches: (options) => options.mini,
  run,
  help: {
    order: 150,
    lines: ["  aireceipts --mini [selector]          6-line mini-receipt (newest session)"],
  },
};
