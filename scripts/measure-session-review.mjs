#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { arch, platform, release } from "node:os";
import { performance } from "node:perf_hooks";
import {
  detectContextThrash,
  detectStuckLoops,
  detectTrivialSpans,
  evaluateSessionReview,
  listFullSessions,
  loadSession,
  REVIEW_PATTERNS,
  REVIEW_REGISTRY,
} from "../dist/index.js";

const DEFAULT_SOURCES = ["claude-code", "codex", "opencode"];

function parseArgs(argv) {
  let runs = 2;
  let concurrency = 4;
  let sources = DEFAULT_SOURCES;
  let json = false;
  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg.startsWith("--runs=")) {
      runs = Number(arg.slice("--runs=".length));
      continue;
    }
    if (arg.startsWith("--concurrency=")) {
      concurrency = Number(arg.slice("--concurrency=".length));
      continue;
    }
    if (arg.startsWith("--sources=")) {
      sources = arg.slice("--sources=".length).split(",").filter(Boolean);
      continue;
    }
    throw new Error("unknown argument: " + arg);
  }
  if (!json) {
    throw new Error("--json is required");
  }
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error("--runs must be a positive integer");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error("--concurrency must be an integer from 1 to 16");
  }
  if (sources.length === 0 || sources.some((source) => !DEFAULT_SOURCES.includes(source))) {
    throw new Error("--sources must contain only: " + DEFAULT_SOURCES.join(","));
  }
  return { runs, concurrency, sources: [...new Set(sources)].sort() };
}

async function mapBounded(values, concurrency, worker) {
  const output = new Array(values.length);
  let next = 0;
  async function run() {
    for (;;) {
      const index = next++;
      if (index >= values.length) {
        return;
      }
      output[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => run()));
  return output;
}

function rootSummaries(summaries, sources) {
  const allowed = new Set(sources);
  const unique = new Map();
  for (const summary of summaries) {
    if (!allowed.has(summary.source) || summary.isSidechain || summary.parentSessionId) {
      continue;
    }
    unique.set(summary.source + "\0" + summary.id, summary);
  }
  return [...unique.values()].sort((left, right) =>
    left.source.localeCompare(right.source) || left.id.localeCompare(right.id),
  );
}

function corpusDigest(summaries) {
  const hash = createHash("sha256");
  for (const summary of summaries) {
    hash.update(summary.source);
    hash.update("\0");
    hash.update(summary.id);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function countMap(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

function pct(count, total) {
  return total === 0 ? 0 : Math.round((count / total) * 10000) / 100;
}

function maxRssMiB() {
  return Math.round((process.resourceUsage().maxRSS / 1024) * 10) / 10;
}

async function inspectSession(session) {
  const [evaluation, loops, context, shortTurns] = await Promise.all([
    evaluateSessionReview(session),
    detectStuckLoops(session),
    detectContextThrash(session),
    detectTrivialSpans(session),
  ]);
  const baseline = loops.length > 0 || context.length > 0 || shortTurns !== null;
  const visiblePatternIds = REVIEW_PATTERNS
    .filter(({ pattern }) => pattern.rollout.state === "enabled" || pattern.rollout.state === "diagnostic")
    .filter(({ id }) => (evaluation.events.get(id) ?? []).length > 0)
    .map(({ id }) => id);
  const shadowPatternIds = REVIEW_PATTERNS
    .filter(({ pattern }) => pattern.rollout.state === "shadow")
    .filter(({ id }) => (evaluation.events.get(id) ?? []).length > 0)
    .map(({ id }) => id);
  return {
    source: session.source,
    baseline,
    visiblePatternIds,
    shadowPatternIds,
    unavailablePatternIds: evaluation.unavailablePatternIds,
  };
}

function aggregate(results, sourceOrder) {
  const patternIds = REVIEW_PATTERNS.map(({ id }) => id);
  const overall = {
    loaded: results.length,
    baselineSessions: 0,
    visibleSessions: 0,
    visibleIncrementalSessions: 0,
    visibleOrShadowSessions: 0,
    visibleOrShadowIncrementalSessions: 0,
    visiblePatternSessions: countMap(patternIds),
    shadowPatternSessions: countMap(patternIds),
    unavailablePatternSessions: countMap(patternIds),
  };
  const bySource = Object.fromEntries(sourceOrder.map((source) => [source, {
    loaded: 0,
    baselineSessions: 0,
    visibleSessions: 0,
    visibleIncrementalSessions: 0,
    visibleOrShadowSessions: 0,
    visibleOrShadowIncrementalSessions: 0,
    visiblePatternSessions: countMap(patternIds),
    shadowPatternSessions: countMap(patternIds),
    unavailablePatternSessions: countMap(patternIds),
  }]));

  for (const result of results) {
    const source = bySource[result.source];
    source.loaded++;
    if (result.baseline) {
      overall.baselineSessions++;
      source.baselineSessions++;
    }
    const visible = result.visiblePatternIds.length > 0;
    const withShadow = visible || result.shadowPatternIds.length > 0;
    if (visible) {
      overall.visibleSessions++;
      source.visibleSessions++;
      if (!result.baseline) {
        overall.visibleIncrementalSessions++;
        source.visibleIncrementalSessions++;
      }
    }
    if (withShadow) {
      overall.visibleOrShadowSessions++;
      source.visibleOrShadowSessions++;
      if (!result.baseline) {
        overall.visibleOrShadowIncrementalSessions++;
        source.visibleOrShadowIncrementalSessions++;
      }
    }
    result.visiblePatternIds.forEach((id) => {
      increment(overall.visiblePatternSessions, id);
      increment(source.visiblePatternSessions, id);
    });
    result.shadowPatternIds.forEach((id) => {
      increment(overall.shadowPatternSessions, id);
      increment(source.shadowPatternSessions, id);
    });
    result.unavailablePatternIds.forEach((id) => {
      increment(overall.unavailablePatternSessions, id);
      increment(source.unavailablePatternSessions, id);
    });
  }

  for (const source of Object.values(bySource)) {
    source.baselineReachPct = pct(source.baselineSessions, source.loaded);
    source.visibleReachPct = pct(source.visibleSessions, source.loaded);
    source.visibleGainPoints = Math.round((source.visibleReachPct - source.baselineReachPct) * 100) / 100;
    source.visibleOrShadowReachPct = pct(source.visibleOrShadowSessions, source.loaded);
    source.visibleOrShadowGainPoints = Math.round((source.visibleOrShadowReachPct - source.baselineReachPct) * 100) / 100;
  }
  overall.baselineReachPct = pct(overall.baselineSessions, overall.loaded);
  overall.visibleReachPct = pct(overall.visibleSessions, overall.loaded);
  overall.visibleGainPoints = Math.round((overall.visibleReachPct - overall.baselineReachPct) * 100) / 100;
  overall.visibleOrShadowReachPct = pct(overall.visibleOrShadowSessions, overall.loaded);
  overall.visibleOrShadowGainPoints = Math.round((overall.visibleOrShadowReachPct - overall.baselineReachPct) * 100) / 100;
  overall.visibleGateMet = overall.visibleReachPct >= 15 && overall.visibleGainPoints >= 10;
  overall.visibleOrShadowGateWouldBeMet =
    overall.visibleOrShadowReachPct >= 15 && overall.visibleOrShadowGainPoints >= 10;
  return { overall, bySource };
}

function deterministicDigest(aggregateResult) {
  return createHash("sha256").update(JSON.stringify(aggregateResult)).digest("hex");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const discoveryStarted = performance.now();
  const before = rootSummaries(await listFullSessions(), options.sources);
  const discoveryMs = Math.round((performance.now() - discoveryStarted) * 10) / 10;
  const beforeDigest = corpusDigest(before);

  const runResults = [];
  for (let run = 0; run < options.runs; run++) {
    const started = performance.now();
    const inspectedOrNull = await mapBounded(before, options.concurrency, async (summary) => {
      const session = await loadSession(summary);
      return session === null ? null : inspectSession(session);
    });
    const inspected = inspectedOrNull.filter(Boolean);
    const counts = aggregate(inspected, options.sources);
    runResults.push({
      wallTimeMs: Math.round((performance.now() - started) * 10) / 10,
      loadFailureCount: before.length - inspected.length,
      deterministicDigest: deterministicDigest(counts),
      ...counts,
    });
  }

  const after = rootSummaries(await listFullSessions(), options.sources);
  const afterDigest = corpusDigest(after);
  const discoveredBySource = Object.fromEntries(options.sources.map((source) => [
    source,
    before.filter((summary) => summary.source === source).length,
  ]));
  const firstRun = runResults[0];
  const loadedBySource = Object.fromEntries(options.sources.map((source) => [source, firstRun.bySource[source].loaded]));

  const result = {
    spec: "SPEC-0083",
    baselineSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    measuredAt: new Date().toISOString(),
    runtime: { node: process.version, platform: platform(), release: release(), arch: arch() },
    registryVersion: REVIEW_REGISTRY.registryVersion,
    ruleVersions: Object.fromEntries(REVIEW_PATTERNS.map(({ id, pattern }) => [id, {
      ruleVersion: pattern.ruleVersion,
      state: pattern.rollout.state,
    }])),
    privacy: {
      retainedFields: ["source-family", "booleans", "counts", "versions", "timings", "peak-rss"],
      retainedContentOrPaths: false,
    },
    configuration: options,
    snapshot: {
      inputListFrozen: true,
      discoveredRootSessions: before.length,
      loadedRootSessions: firstRun.overall.loaded,
      loadFailureCount: firstRun.loadFailureCount,
      discoveredBySource,
      loadedBySource,
      digest: beforeDigest,
      discoveryStableAcrossRun: before.length === after.length && beforeDigest === afterDigest,
    },
    timings: { discoveryMs },
    runs: runResults,
    deterministicAcrossRuns: new Set(runResults.map((run) => run.deterministicDigest)).size === 1,
    maxRssMiB: maxRssMiB(),
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write("measure-session-review: " + (error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 1;
});
