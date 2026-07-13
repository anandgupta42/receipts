// SPEC-0083: public post-session review. The historical boolean flag remains a
// hidden invocation alias and reaches these same bytes.
import { aggregateWaste, type WasteClassAggregate } from "../../aggregate/waste.js";
import { partitionWindows, windowBounds } from "../../aggregate/week.js";
import { listFullSessions, loadSession } from "../../index.js";
import type { Session } from "../../parse/types.js";
import { mapWithConcurrency } from "../../parse/util.js";
import { buildReviewReportWithMeasurements, DEFAULT_REVIEW_THRESHOLD, renderReview } from "../../receipt/review.js";
import { resolveSelector } from "../common/session.js";
import type { CommandContext, CommandDef } from "../types.js";

function sessionKey(session: Pick<Session, "source" | "id">): string {
  return session.source + "\0" + session.id;
}

async function recentSessions(
  now: number,
  preloaded: readonly Session[],
): Promise<Session[]> {
  const bounds = windowBounds(now);
  const summaries = await listFullSessions();
  const { current } = partitionWindows(summaries, bounds);
  const loads = new Map<string, Promise<Session | null>>(
    preloaded.map((session) => [sessionKey(session), Promise.resolve(session)]),
  );
  const loaded = await mapWithConcurrency(current, 8, (summary) => {
    const key = sessionKey(summary);
    const existing = loads.get(key);
    if (existing) {
      return existing;
    }
    const pending = loadSession(summary);
    loads.set(key, pending);
    return pending;
  });
  return loaded.filter((session): session is Session => session !== null);
}

export async function recentReviewSessions(
  now: number = Date.now(),
  preloaded: readonly Session[] = [],
): Promise<Session[]> {
  return recentSessions(now, preloaded);
}

/** Compatibility export for the weekly waste aggregation tests and API. */
export async function recentWasteAggregates(
  now: number = Date.now(),
  preloaded: readonly Session[] = [],
): Promise<WasteClassAggregate[]> {
  return aggregateWaste(await recentSessions(now, preloaded));
}

async function run(ctx: CommandContext): Promise<number> {
  const { options } = ctx;
  const threshold = options.reviewThreshold ?? DEFAULT_REVIEW_THRESHOLD;
  if (options.reviewThreshold !== undefined && (!Number.isInteger(threshold) || threshold < 1)) {
    ctx.stderr.write("invalid --review-threshold (expected a positive integer)\n");
    return 1;
  }

  const publicInvocation = options.positional[0] === "review";
  const selector = publicInvocation ? options.positional[1] : options.positional[0];
  const resolved = await resolveSelector(selector);
  if ("error" in resolved) {
    ctx.stderr.write(resolved.error + "\n");
    return 1;
  }
  const session = resolved.session ?? (await loadSession(resolved.summary));
  if (!session) {
    ctx.stderr.write("failed to load selected session\n");
    return 1;
  }

  const recent = await recentReviewSessions(ctx.now(), [session]);
  const { report, patternMeasurements } = await buildReviewReportWithMeasurements(session, recent, threshold);
  ctx.stdout.write((options.json ? JSON.stringify(report, null, 2) : renderReview(report)) + "\n");
  for (const measurement of patternMeasurements) {
    ctx.telemetry.recordReviewPatternEvaluated(measurement);
  }
  return 0;
}

export const command: CommandDef = {
  name: "review",
  priority: 40,
  matches: (options) => options.handoff || options.positional[0] === "review",
  run,
  help: {
    order: 40,
    lines: [
      "  aireceipts review [selector] [--review-threshold N] [--json]",
      "                                        find recorded session problems and",
      "                                         recommend how to prevent them next time",
    ],
  },
};
