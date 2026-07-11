// SPEC-0018: `pr` — attach the building session's receipt to the current PR
// (SPEC-0019). priority 60, matches the `pr` positional subcommand. `--post`
// upserts via gh; without it, a dry run prints the body.
import { runPrDetailed } from "../../pr/index.js";
import type { CommandContext, CommandDef } from "../types.js";
import type { CliOptions } from "../options.js";
import { receiptTelemetryFromModels } from "../common/telemetry.js";
import { renderCardSvg } from "../../receipt/card.js";
import { rasterizeSvgToPng } from "../../receipt/png.js";
import { writePng, writeSvg } from "../common/output.js";
import { defaultCardShareDeps, runCardShare } from "../../receipt/shareCard.js";

/**
 * SPEC-0077 R2 — the PR number for the card's fixed `PR #<n>` scope label. Taken
 * LOCALLY (`aireceipts pr <n> --card`, or `--pr <n>`) so the card render never
 * touches the network (I1): a positive integer positional/flag, else undefined.
 */
function cardPrNumber(options: CliOptions): number | undefined {
  const raw = options.positional[1] ?? options.prNumber;
  if (raw === undefined) {
    return undefined;
  }
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** SPEC-0077 R1/R4 — reject the illegal `--card` combinations before any work. Returns the usage message, or `null` when the combination is legal. */
function cardUsageError(options: CliOptions): string | null {
  if (options.svg && options.png) {
    return "--card writes one file — use --card (PNG) or --card --svg, not both";
  }
  if (options.byProject) {
    return "--card is always sanitized — --by-project cannot combine with it";
  }
  return null;
}

async function run(ctx: CommandContext): Promise<number> {
  // SPEC-0077 R1/R4 — validate the card combinations and resolve its PR number
  // up front, before the (possibly networked) `--post` flow runs.
  let cardPr: number | undefined;
  // SPEC-0077 R5 — `--link` is a card-caption opt-in; reject it without `--card`.
  if (ctx.options.link && !ctx.options.card) {
    ctx.stderr.write("--link only applies to pr --card\n");
    return 1;
  }
  if (ctx.options.card) {
    const cardError = cardUsageError(ctx.options);
    if (cardError) {
      ctx.stderr.write(`${cardError}\n`);
      return 1;
    }
    cardPr = cardPrNumber(ctx.options);
    if (cardPr === undefined) {
      ctx.stderr.write("pr --card needs the PR number locally: aireceipts pr <n> --card\n");
      return 1;
    }
  }
  const result = await runPrDetailed({
    post: ctx.options.post,
    session: ctx.options.prSession,
    artifact: ctx.options.artifact,
    details: !ctx.options.noDetails,
    share: ctx.options.share,
    store: ctx.options.store,
    pushRef: ctx.options.pushRef,
    samosa: ctx.options.samosa,
    card: ctx.options.card,
    prNumber: cardPr,
    link: ctx.options.link,
  });
  // SPEC-0077 R1/R6 — write the shareable card (`--card` → PNG default, `--card
  // --svg` → the deterministic SVG), then run the local share step: image on the
  // clipboard, caption + intent URLs printed. The pasteable body still prints
  // first (R3 spine). No browser, no network from the card path (I1).
  if (ctx.options.card && result.cardModel) {
    const format = ctx.options.svg ? "svg" : "png";
    const imagePath = ctx.options.output ?? (ctx.options.svg ? "card.svg" : "card.png");
    const svg = renderCardSvg(result.cardModel, { theme: ctx.options.theme });
    if (ctx.options.svg) {
      await writeSvg(ctx, svg, imagePath);
    } else {
      await writePng(ctx, rasterizeSvgToPng(svg, 1200), imagePath);
    }
    const share = runCardShare(
      { model: result.cardModel, imagePath, format, link: result.cardLink },
      defaultCardShareDeps((line) => ctx.stdout.write(`${line}\n`)),
    );
    ctx.telemetry.recordCardGenerated({
      scope: "pr",
      theme: ctx.options.theme,
      format,
      linkIncluded: share.linkIncluded,
      clipboardImageCopied: share.clipboardImageCopied,
    });
  }
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
    handoffSectionIncluded: result.handoffSectionIncluded,
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
      "                [--store <comment|ref>] [--push-ref] [--samosa]",
      "                                        attach the building session's receipt to",
      "                                         the current PR (dry-run prints the body;",
      "                                         --post upserts it via gh; --artifact also",
      "                                         publishes pr-<n>.html to the",
      "                                         aireceipts/artifacts branch and links it;",
      "                                         --share prints ready-to-paste X/LinkedIn",
      "                                         intent URLs to stderr, requires --artifact;",
      "                                         --store ref also writes the receipt to",
      "                                         refs/aireceipts/<slug> (SPEC-0065); default",
      "                                         comment; --push-ref also pushes that ref to",
      "                                         origin, only meaningful with --store ref;",
      "                                         --samosa opts the tip link back onto the",
      "                                         comment + artifact, off by default)",
    ],
  },
};
