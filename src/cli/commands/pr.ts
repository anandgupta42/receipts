// SPEC-0018: `pr` — attach the building session's receipt to the current PR
// (SPEC-0019). priority 60, matches the `pr` positional subcommand. `--post`
// upserts via gh; without it, a dry run prints the body.
import { runPrDetailed } from "../../pr/index.js";
import type { CommandContext, CommandDef } from "../types.js";
import { receiptTelemetryFromModels } from "../common/telemetry.js";

async function run(ctx: CommandContext): Promise<number> {
  const result = await runPrDetailed({
    post: ctx.options.post,
    session: ctx.options.prSession,
    artifact: ctx.options.artifact,
    details: !ctx.options.noDetails,
    share: ctx.options.share,
  });
  if (result.bodyRendered && result.receipt) {
    await ctx.telemetry.noteReceiptGenerated(
      receiptTelemetryFromModels({
        surface: "pr",
        models: result.receipt.models,
        outputMode: "markdown",
        template: "none",
        turnCount: result.receipt.turnCount,
        toolCallCount: result.receipt.toolCallCount,
        detailsView: false,
      }),
      "pr",
    );
    await ctx.telemetry.noteMilestone("first_pr", "pr");
  }
  ctx.telemetry.recordPrFlowCompleted({
    mode: ctx.options.post ? "post" : "dry_run",
    artifactRequested: ctx.options.artifact,
    shareRequested: ctx.options.share,
    contributorCount: result.contributorCount,
    commentResult: result.commentResult,
    artifactResult: result.artifactResult,
    shareResult: result.shareResult,
    result: result.result,
  });
  if (result.commentResult === "success") {
    await ctx.telemetry.noteMilestone("first_pr_post", "pr");
  }
  if (result.artifactResult === "success") {
    await ctx.telemetry.noteMilestone("first_artifact", "pr");
    ctx.telemetry.recordExportGenerated({ surface: "pr", format: "html", wroteFile: true, result: "success" });
    await ctx.telemetry.noteMilestone("first_export", "pr");
  }
  return result.code;
}

export const command: CommandDef = {
  name: "pr",
  priority: 60,
  matches: (options) => options.positional[0] === "pr",
  run,
  help: {
    order: 100,
    lines: [
      "  aireceipts pr [--post] [--session <id>] [--artifact] [--no-details] [--share]",
      "                                        attach the building session's receipt to",
      "                                         the current PR (dry-run prints the body;",
      "                                         --post upserts it via gh; --artifact also",
      "                                         publishes pr-<n>.html to the",
      "                                         aireceipts/artifacts branch and links it;",
      "                                         --share prints ready-to-paste X/LinkedIn",
      "                                         intent URLs to stderr, requires --artifact)",
    ],
  },
};
