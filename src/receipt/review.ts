import type { AgentSource, Session, TokenUsage } from "../parse/types.js";
import { addUsage, emptyUsage, mapWithConcurrency } from "../parse/util.js";
import { defaultDataDir } from "../pricing/priceTable.js";
import { formatDuration, formatInt, formatUsdLowerBound } from "./format.js";
import { SOURCE_LABELS } from "../parse/types.js";
import { buildReviewActions, runtimeCapabilities, type ReviewAction } from "./reviewActions.js";
import {
  extractReviewEvents,
  hasRequiredCapabilities,
  REVIEW_PATTERNS,
  REVIEW_REGISTRY,
  type ReviewEvent,
  type ReviewEventImpact,
  type ReviewFactName,
  type ReviewPattern,
  type ReviewPatternId,
} from "./reviewRegistry.js";

export const DEFAULT_REVIEW_THRESHOLD = 3;
export const REVIEW_SCHEMA_VERSION = 1;

const FACT_ORDER: ReviewFactName[] = [
  "attempts",
  "triggering-attempts",
  "retries-after-first-error",
  "consecutive-errors",
  "repeated-reads",
  "source-writes",
  "failed-checks",
  "compactions",
  "window-turns",
  "qualifying-turns",
];

const FACT_LABELS: Record<ReviewFactName, string> = {
  attempts: "recorded attempts",
  "triggering-attempts": "attempts after the first two",
  "retries-after-first-error": "retries after the first error",
  "consecutive-errors": "consecutive errors",
  "repeated-reads": "repeated reads after the first two",
  "source-writes": "source writes after the last passing check",
  "failed-checks": "check types ending in failure",
  compactions: "context reductions",
  "window-turns": "turns in measured windows",
  "qualifying-turns": "qualifying short replies",
};

export interface ReviewEvidence {
  eventCount: number;
  actionCount: number;
  turnIndices: number[];
  totalTurnCount: number;
  tools: string[];
  totalToolCount: number;
  facts: { name: ReviewFactName; value: number }[];
}

export interface ReviewTokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  cacheCreation5m: number | null;
  cacheCreation1h: number | null;
  total: number;
}

export type ReviewImpact =
  | {
      role: "observed-attributed";
      tokens: ReviewTokenUsage;
      usd: number | null;
      durationMs: number | null;
    }
  | {
      role: "observed-window";
      tokens: ReviewTokenUsage;
      usd: number | null;
    }
  | {
      role: "same-token-reprice";
      tokens: ReviewTokenUsage;
      observedUsd: number;
      repricedUsd: number;
    };

export interface ReviewRecurrence {
  distinctSessionCount: number;
  windowDays: number;
  recommendation: string;
}

export interface ReviewFinding {
  ruleVersion: number;
  category: "issue" | "cost-opportunity" | "observation";
  title: string;
  whatHappened: string;
  whyItMatters: string;
  recommendation: string;
  evidenceStrength: string;
  claimLimit: string;
  evidence: ReviewEvidence;
  impact?: ReviewImpact;
  recurrence?: ReviewRecurrence;
}

export interface ReviewCoverage {
  evaluated: { count: number; patternIds: ReviewPatternId[] };
  unavailable: { count: number; patternIds: ReviewPatternId[] };
}

export interface SessionReviewEvaluation {
  source: AgentSource;
  actions: ReviewAction[];
  events: Map<ReviewPatternId, ReviewEvent[]>;
  evaluatedPatternIds: ReviewPatternId[];
  unavailablePatternIds: ReviewPatternId[];
  shadowFirings: Partial<Record<ReviewPatternId, number>>;
}

export interface ReviewReport {
  schemaVersion: typeof REVIEW_SCHEMA_VERSION;
  review: {
    registryVersion: number;
    source: AgentSource;
    findings: Partial<Record<ReviewPatternId, ReviewFinding>>;
    coverage: ReviewCoverage;
  };
}

/** Content-free, registry-derived row recorded once per shadow rule for a selected review. */
export interface ReviewPatternMeasurement {
  registryVersion: typeof REVIEW_REGISTRY.registryVersion;
  patternId: ReviewPatternId;
  ruleVersion: number;
  rolloutState: "shadow";
  agentType: AgentSource;
  evaluationStatus: "evaluated" | "unavailable";
  findingCount: number;
}

export interface ReviewBuildResult {
  report: ReviewReport;
  patternMeasurements: readonly ReviewPatternMeasurement[];
}

/** Registry-backed, privacy-safe review block shared by PR comments and artifacts. */
export interface PrReviewView {
  summary: string;
  text: string;
}

function overlaps(a: ReviewEvent, b: ReviewEvent): boolean {
  const keys = new Set(a.overlapKeys);
  return b.overlapKeys.some((key) => keys.has(key));
}

function applySupersession(events: Map<ReviewPatternId, ReviewEvent[]>): void {
  for (const { id, pattern } of REVIEW_PATTERNS) {
    const winners = events.get(id) ?? [];
    if (winners.length === 0) {
      continue;
    }
    for (const loserId of pattern.supersedes as ReviewPatternId[]) {
      const losers = events.get(loserId) ?? [];
      events.set(
        loserId,
        losers.filter((loser) => !winners.some((winner) => overlaps(winner, loser))),
      );
    }
  }
}

export async function evaluateSessionReview(
  session: Session,
  dataDir: string = defaultDataDir(),
): Promise<SessionReviewEvaluation> {
  const actions = await buildReviewActions(session, dataDir);
  const capabilities = runtimeCapabilities(session.source);
  const events = new Map<ReviewPatternId, ReviewEvent[]>();
  const evaluatedPatternIds: ReviewPatternId[] = [];
  const unavailablePatternIds: ReviewPatternId[] = [];
  const shadowFirings: Partial<Record<ReviewPatternId, number>> = {};

  for (const { id, pattern } of REVIEW_PATTERNS) {
    if (pattern.rollout.state === "disabled") {
      continue;
    }
    if (!hasRequiredCapabilities(pattern, capabilities)) {
      if (pattern.rollout.state !== "shadow") {
        unavailablePatternIds.push(id);
      }
      continue;
    }
    const extracted = await extractReviewEvents(pattern, { session, actions, dataDir });
    events.set(id, extracted);
    if (pattern.rollout.state !== "shadow") {
      evaluatedPatternIds.push(id);
    }
  }

  applySupersession(events);
  for (const { id, pattern } of REVIEW_PATTERNS) {
    const count = events.get(id)?.length ?? 0;
    if (pattern.rollout.state === "shadow" && count > 0) {
      shadowFirings[id] = count;
    }
  }
  return {
    source: session.source,
    actions,
    events,
    evaluatedPatternIds,
    unavailablePatternIds,
    shadowFirings,
  };
}

function aggregateEvidence(events: readonly ReviewEvent[]): ReviewEvidence {
  const factTotals = new Map<ReviewFactName, number>();
  const actionIndices = new Set<number>();
  const turns = new Set<number>();
  const tools = new Set<string>();
  for (const event of events) {
    for (const [name, value] of Object.entries(event.facts) as [ReviewFactName, number][]) {
      factTotals.set(name, (factTotals.get(name) ?? 0) + value);
    }
    for (const key of event.overlapKeys) {
      if (key.startsWith("action:")) {
        actionIndices.add(Number(key.slice("action:".length)));
      }
    }
    event.turnIndices.forEach((turn) => turns.add(turn));
    event.tools.forEach((tool) => tools.add(tool));
  }
  const allTurns = [...turns].sort((a, b) => a - b);
  const allTools = [...tools].sort();
  return {
    eventCount: events.length,
    actionCount: actionIndices.size,
    turnIndices: allTurns.slice(0, 20),
    totalTurnCount: allTurns.length,
    tools: allTools.slice(0, 8),
    totalToolCount: allTools.length,
    facts: FACT_ORDER
      .filter((name) => factTotals.has(name))
      .map((name) => ({ name, value: factTotals.get(name) as number })),
  };
}

function attributedImpact(
  events: readonly ReviewEvent[],
  actions: readonly ReviewAction[],
): ReviewImpact | undefined {
  const indices = new Set(events.flatMap((event) => event.impactActionIndices));
  if (indices.size === 0) {
    return undefined;
  }
  const selected = actions.filter((action) => indices.has(action.index));
  const tokens = selected.reduce((total, action) => addUsage(total, action.attributedTokens), emptyUsage());
  const completeUsd = selected.every((action) => action.attributedUsd !== null);
  const completeDuration = selected.every((action) => action.durationMs !== null);
  return {
    role: "observed-attributed",
    tokens: reviewTokenUsage(tokens),
    usd: completeUsd ? selected.reduce((total, action) => total + (action.attributedUsd as number), 0) : null,
    durationMs: completeDuration ? selected.reduce((total, action) => total + (action.durationMs as number), 0) : null,
  };
}

function windowImpact(events: readonly ReviewEvent[]): ReviewImpact | undefined {
  const impacts = events
    .map((event) => event.impact)
    .filter((impact): impact is Extract<ReviewEventImpact, { role: "observed-window" }> => impact?.role === "observed-window");
  if (impacts.length === 0) {
    return undefined;
  }
  const tokens = impacts.reduce((total, impact) => addUsage(total, impact.tokens), emptyUsage());
  return {
    role: "observed-window",
    tokens: reviewTokenUsage(tokens),
    usd: impacts.every((impact) => impact.usd !== null)
      ? impacts.reduce((total, impact) => total + (impact.usd as number), 0)
      : null,
  };
}

function repriceImpact(events: readonly ReviewEvent[]): ReviewImpact | undefined {
  const impacts = events
    .map((event) => event.impact)
    .filter((impact): impact is Extract<ReviewEventImpact, { role: "same-token-reprice" }> => impact?.role === "same-token-reprice");
  if (impacts.length === 0) {
    return undefined;
  }
  return {
    role: "same-token-reprice",
    tokens: reviewTokenUsage(impacts.reduce((total, impact) => addUsage(total, impact.tokens), emptyUsage())),
    observedUsd: impacts.reduce((total, impact) => total + (impact.observedUsd ?? 0), 0),
    repricedUsd: impacts.reduce((total, impact) => total + (impact.repricedUsd ?? 0), 0),
  };
}

function reviewTokenUsage(usage: TokenUsage): ReviewTokenUsage {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheCreation: usage.cacheCreation,
    cacheCreation5m: usage.cacheCreation5m ?? null,
    cacheCreation1h: usage.cacheCreation1h ?? null,
    total: usage.total,
  };
}

function impactFor(
  pattern: ReviewPattern,
  events: readonly ReviewEvent[],
  actions: readonly ReviewAction[],
): ReviewImpact | undefined {
  if (pattern.impact.role === "observed-attributed") {
    return attributedImpact(events, actions);
  }
  if (pattern.impact.role === "observed-window") {
    return windowImpact(events);
  }
  if (pattern.impact.role === "same-token-reprice") {
    return repriceImpact(events);
  }
  return undefined;
}

function findingOf(pattern: ReviewPattern, events: readonly ReviewEvent[], actions: readonly ReviewAction[]): ReviewFinding {
  const impact = impactFor(pattern, events, actions);
  return {
    ruleVersion: pattern.ruleVersion,
    category: pattern.category,
    title: pattern.title,
    whatHappened: pattern.description,
    whyItMatters: pattern.whyItMatters,
    recommendation: pattern.recommendation,
    evidenceStrength: pattern.evidenceStrength,
    claimLimit: pattern.claimLimit,
    evidence: aggregateEvidence(events),
    ...(impact ? { impact } : {}),
  };
}

function sessionKey(session: Pick<Session, "source" | "id">): string {
  return session.source + "\0" + session.id;
}

function patternMeasurementsOf(evaluation: SessionReviewEvaluation): ReviewPatternMeasurement[] {
  return REVIEW_PATTERNS.filter(({ pattern }) => pattern.rollout.state === "shadow").map(({ id, pattern }) => {
    const extracted = evaluation.events.get(id);
    return {
      registryVersion: REVIEW_REGISTRY.registryVersion,
      patternId: id,
      ruleVersion: pattern.ruleVersion,
      rolloutState: "shadow",
      agentType: evaluation.source,
      evaluationStatus: extracted === undefined ? "unavailable" : "evaluated",
      findingCount: extracted?.length ?? 0,
    };
  });
}

export async function buildReviewReportWithMeasurements(
  selected: Session,
  recentSessions: readonly Session[] = [],
  threshold: number = DEFAULT_REVIEW_THRESHOLD,
  dataDir: string = defaultDataDir(),
): Promise<ReviewBuildResult> {
  const selectedEvaluation = await evaluateSessionReview(selected, dataDir);
  const uniqueRecent = new Map<string, Session>();
  for (const session of recentSessions) {
    uniqueRecent.set(sessionKey(session), session);
  }
  uniqueRecent.set(sessionKey(selected), selected);
  const otherRecent = [...uniqueRecent.values()].filter((session) => sessionKey(session) !== sessionKey(selected));
  const recentEvaluations = await mapWithConcurrency(otherRecent, 4, (session) => evaluateSessionReview(session, dataDir));
  const allEvaluations = [selectedEvaluation, ...recentEvaluations];

  const findings: Partial<Record<ReviewPatternId, ReviewFinding>> = {};
  for (const { id, pattern } of REVIEW_PATTERNS) {
    if (pattern.rollout.state !== "enabled" && pattern.rollout.state !== "diagnostic") {
      continue;
    }
    const events = selectedEvaluation.events.get(id) ?? [];
    if (events.length === 0) {
      continue;
    }
    const finding = findingOf(pattern, events, selectedEvaluation.actions);
    if (pattern.recurrence.eligible) {
      const distinctSessionCount = allEvaluations.filter((evaluation) => (evaluation.events.get(id) ?? []).length > 0).length;
      if (distinctSessionCount >= threshold) {
        finding.recurrence = {
          distinctSessionCount,
          windowDays: pattern.recurrence.windowDays,
          recommendation: pattern.recommendation,
        };
      }
    }
    findings[id] = finding;
  }

  const report: ReviewReport = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    review: {
      registryVersion: REVIEW_REGISTRY.registryVersion,
      source: selected.source,
      findings,
      coverage: {
        evaluated: {
          count: selectedEvaluation.evaluatedPatternIds.length,
          patternIds: selectedEvaluation.evaluatedPatternIds,
        },
        unavailable: {
          count: selectedEvaluation.unavailablePatternIds.length,
          patternIds: selectedEvaluation.unavailablePatternIds,
        },
      },
    },
  };
  return { report, patternMeasurements: patternMeasurementsOf(selectedEvaluation) };
}

export async function buildReviewReport(
  selected: Session,
  recentSessions: readonly Session[] = [],
  threshold: number = DEFAULT_REVIEW_THRESHOLD,
  dataDir: string = defaultDataDir(),
): Promise<ReviewReport> {
  return (await buildReviewReportWithMeasurements(selected, recentSessions, threshold, dataDir)).report;
}

function evidenceText(evidence: ReviewEvidence): string {
  const parts = evidence.facts.map((fact) => FACT_LABELS[fact.name] + ": " + formatInt(fact.value));
  if (evidence.turnIndices.length > 0) {
    const suffix = evidence.totalTurnCount > evidence.turnIndices.length ? " of " + formatInt(evidence.totalTurnCount) : "";
    parts.push("recorded turns" + suffix + ": " + evidence.turnIndices.map((turn) => formatInt(turn + 1)).join(", "));
  }
  if (evidence.tools.length > 0) {
    const suffix = evidence.totalToolCount > evidence.tools.length ? " of " + formatInt(evidence.totalToolCount) : "";
    parts.push("tools" + suffix + ": " + evidence.tools.join(", "));
  }
  return parts.join(" · ");
}

function impactText(impact: ReviewImpact): string {
  if (impact.role === "same-token-reprice") {
    return (
      "Same recorded tokens at listed prices: " +
      formatUsdLowerBound(impact.observedUsd) +
      " observed; " +
      formatUsdLowerBound(impact.repricedUsd) +
      " at the lower-priced same-provider row · " +
      formatInt(impact.tokens.total) +
      " tokens"
    );
  }
  const label = impact.role === "observed-attributed"
    ? "Observed cost attributed to these actions"
    : "Observed cost in the measured window";
  const cost = impact.usd === null ? formatInt(impact.tokens.total) + " tokens" : formatUsdLowerBound(impact.usd);
  if (impact.role === "observed-attributed" && impact.durationMs !== null) {
    return label + ": " + cost + " · " + formatDuration(impact.durationMs);
  }
  return label + ": " + cost;
}

const GROUPS = [
  { category: "issue" as const, heading: "THINGS TO IMPROVE" },
  { category: "cost-opportunity" as const, heading: "COST OPPORTUNITIES" },
  { category: "observation" as const, heading: "THINGS TO WATCH" },
];

export function renderReview(report: ReviewReport): string {
  const lines = ["SESSION REVIEW", "Source: " + SOURCE_LABELS[report.review.source]];
  const entries = REVIEW_PATTERNS
    .map(({ id }) => ({ id, finding: report.review.findings[id] }))
    .filter((entry): entry is { id: ReviewPatternId; finding: ReviewFinding } => entry.finding !== undefined);
  if (entries.length === 0) {
    lines.push("", "No supported issues found in the recorded evidence.");
  } else {
    for (const group of GROUPS) {
      const grouped = entries.filter((entry) => entry.finding.category === group.category);
      if (grouped.length === 0) {
        continue;
      }
      lines.push("", group.heading);
      for (const { finding } of grouped) {
        lines.push(
          "",
          finding.title,
          "  What happened: " + finding.whatHappened,
          "  Evidence: " + evidenceText(finding.evidence),
          "  Why it matters: " + finding.whyItMatters,
          "  Prevent it next time: " + finding.recommendation,
        );
        if (finding.impact) {
          lines.push("  " + impactText(finding.impact));
        }
        lines.push("  What this does not prove: " + finding.claimLimit);
        if (finding.recurrence) {
          lines.push(
            "  Recurring: seen in " +
              formatInt(finding.recurrence.distinctSessionCount) +
              " distinct sessions in the last " +
              formatInt(finding.recurrence.windowDays) +
              " days. Consider adding this prevention step to project instructions: " +
              finding.recurrence.recommendation,
          );
        }
      }
    }
  }
  const evaluated = report.review.coverage.evaluated;
  const unavailable = report.review.coverage.unavailable;
  lines.push(
    "",
    "COVERAGE",
    "Checks run: " + formatInt(evaluated.count),
    "Checks unavailable for this trace: " + formatInt(unavailable.count),
  );
  return lines.join("\n");
}

/**
 * Aggregate already-sanitized review reports for a PR. This deliberately keeps
 * per-session identity, raw tool evidence, and unlike impact roles out of the
 * rollup. Pattern order and every recommendation still come from the registry.
 */
export function buildPrReview(reports: readonly ReviewReport[]): PrReviewView | null {
  const present = REVIEW_PATTERNS.flatMap(({ id, pattern }) => {
    const findings = reports.flatMap((report) => {
      const finding = report.review.findings[id];
      return finding === undefined ? [] : [finding];
    });
    return findings.length === 0 ? [] : [{ id, pattern, findings }];
  });
  if (present.length === 0) {
    return null;
  }

  const lines = [
    "SESSION REVIEW",
    "Recorded across " + formatInt(reports.length) + " session" + (reports.length === 1 ? "" : "s"),
  ];
  for (const group of GROUPS) {
    const grouped = present.filter(({ pattern }) => pattern.category === group.category);
    if (grouped.length === 0) {
      continue;
    }
    lines.push("", group.heading);
    for (const { pattern, findings } of grouped) {
      const eventCount = findings.reduce((total, finding) => total + finding.evidence.eventCount, 0);
      lines.push(
        "",
        pattern.title,
        "  Evidence: " +
          formatInt(findings.length) +
          " session" +
          (findings.length === 1 ? "" : "s") +
          " · " +
          formatInt(eventCount) +
          " recorded match" +
          (eventCount === 1 ? "" : "es"),
        "  Why it matters: " + pattern.whyItMatters,
        "  Prevent it next time: " + pattern.recommendation,
        "  What this does not prove: " + pattern.claimLimit,
      );
    }
  }
  const checksRun = reports.reduce((total, report) => total + report.review.coverage.evaluated.count, 0);
  const unavailable = reports.reduce((total, report) => total + report.review.coverage.unavailable.count, 0);
  lines.push(
    "",
    "COVERAGE",
    "Sessions reviewed: " + formatInt(reports.length),
    "Checks run: " + formatInt(checksRun),
    "Checks unavailable for these traces: " + formatInt(unavailable),
  );

  return {
    summary:
      "session review — " +
      formatInt(present.length) +
      " pattern" +
      (present.length === 1 ? "" : "s") +
      " to prevent",
    text: lines.join("\n"),
  };
}
