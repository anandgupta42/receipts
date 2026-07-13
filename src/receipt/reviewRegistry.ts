import { z } from "zod";
import type { Session, TokenUsage } from "../parse/types.js";
import { detectContextThrash, detectTrivialSpans } from "../pricing/waste.js";
import reviewRegistryJson from "./review-patterns.json" with { type: "json" };
import type { ReviewAction, RuntimeReviewCapability } from "./reviewActions.js";

const CAPABILITIES = [
  "assistant-text",
  "canonical-file-read",
  "canonical-file-write",
  "canonical-read-or-search",
  "canonical-search",
  "canonical-shell-command",
  "canonical-source-write",
  "canonical-validation",
  "canonical-write",
  "compaction-events",
  "complete-tool-output",
  "explicit-reference-run",
  "explicit-reference-scope",
  "normalized-child-lifecycle",
  "normalized-interruption-lifecycle",
  "normalized-task-state",
  "parent-delivery-events",
  "pricing-units",
  "semantic-action-labels",
  "semantic-phase-labels",
  "structured-plan-surface",
  "task-state-freshness",
  "terminal-session-proof",
  "tool-input",
  "tool-name",
  "tool-status",
  "tool-surface",
  "turn-output-tokens",
  "turn-tool-count",
  "turn-usage",
  "write-effect",
] as const;

const IMPACT_METRICS = [
  "actions",
  "attempts",
  "calls",
  "compactions",
  "durationMs",
  "failedChecks",
  "observedUsd",
  "outputs",
  "reads",
  "recordedCharacters",
  "repricedUsd",
  "searches",
  "tokens",
  "turns",
  "usd",
  "writes",
  "writesAfterLastCheck",
] as const;

const recurrenceSchema = z
  .object({
    eligible: z.boolean(),
    windowDays: z.literal(7),
    minimumDistinctSessions: z.literal(3),
  })
  .strict();

const impactSchema = z
  .object({
    role: z.enum(["observed-attributed", "observed-window", "same-token-reprice", "none"]),
    metrics: z.array(z.enum(IMPACT_METRICS)),
  })
  .strict();

const extractorSchema = z.union([
  z
    .object({
      id: z.literal("repeatedIdenticalAttemptV1"),
      parameters: z
        .object({
          minimumRunLength: z.literal(3),
          requireRecordedInput: z.literal(true),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.literal("repeatedIdenticalErrorV1"),
      parameters: z
        .object({
          minimumOccurrences: z.literal(2),
          windowActions: z.literal(10),
          requiredStatus: z.literal("error"),
          resetOnDirectWrite: z.literal(true),
          resetOnSuccessfulValidation: z.literal(true),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.literal("consecutiveToolErrorsV1"),
      parameters: z.object({ minimumRunLength: z.literal(3) }).strict(),
    })
    .strict(),
  z
    .object({
      id: z.literal("sameFileRereadV2"),
      parameters: z
        .object({
          windowActions: z.literal(10),
          minimumReads: z.literal(3),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.literal("lastChangeNotCheckedV1"),
      parameters: z
        .object({
          sourceWritesOnly: z.literal(true),
          requireSuccessfulValidationAfterFinalWrite: z.literal(true),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.literal("lastCheckStillFailingV1"),
      parameters: z.object({ groupByNormalizedCheck: z.literal(true) }).strict(),
    })
    .strict(),
  z
    .object({
      id: z.literal("contextRefillClusterV1"),
      parameters: z
        .object({
          lookaheadTurns: z.literal(5),
          refillRatio: z.literal(0.8),
          maximumCompactionGapTurns: z.literal(25),
          minimumCompactions: z.literal(2),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.literal("shortToolFreeTurnCostV2"),
      parameters: z
        .object({
          maximumOutputTokens: z.literal(120),
          requireDirectSingleProviderPricing: z.literal(true),
        })
        .strict(),
    })
    .strict(),
]);

const patternSchema = z
  .object({
    ruleVersion: z.literal(1),
    rollout: z
      .object({
        state: z.enum(["enabled", "diagnostic", "shadow", "disabled"]),
        reason: z.string().min(1),
      })
      .strict(),
    category: z.enum(["issue", "cost-opportunity", "observation"]),
    title: z.string().min(1),
    description: z.string().min(1),
    whyItMatters: z.string().min(1),
    recommendation: z.string().min(1),
    extractor: extractorSchema.nullable(),
    requiredCapabilities: z.array(z.enum(CAPABILITIES)),
    evidenceStrength: z.string().min(1),
    claimLimit: z.string().min(1),
    impact: impactSchema,
    recurrence: recurrenceSchema,
    supersedes: z.array(z.string()),
    order: z.number().int().positive(),
  })
  .strict();

export type ReviewPatternId = keyof typeof reviewRegistryJson.patterns;
const PATTERN_IDS = Object.keys(reviewRegistryJson.patterns) as ReviewPatternId[];
const patternShape = Object.fromEntries(PATTERN_IDS.map((id) => [id, patternSchema])) as Record<
  ReviewPatternId,
  typeof patternSchema
>;

const registrySchema = z
  .object({
    registryVersion: z.literal(1),
    patterns: z.object(patternShape).strict(),
  })
  .strict();

export type ReviewRegistry = z.infer<typeof registrySchema>;
export type ReviewPattern = ReviewRegistry["patterns"][ReviewPatternId];
type ExtractorConfig = NonNullable<ReviewPattern["extractor"]>;
type ExtractorId = ExtractorConfig["id"];

export function validateReviewRegistry(value: unknown): ReviewRegistry {
  const registry = registrySchema.parse(value);
  const ids = new Set(PATTERN_IDS);
  const orders = new Set<number>();
  for (const id of PATTERN_IDS) {
    const pattern = registry.patterns[id];
    if (orders.has(pattern.order)) {
      throw new Error("Duplicate review pattern order: " + pattern.order);
    }
    orders.add(pattern.order);
    if (new Set(pattern.requiredCapabilities).size !== pattern.requiredCapabilities.length) {
      throw new Error("Duplicate capability in review pattern: " + id);
    }
    if (new Set(pattern.impact.metrics).size !== pattern.impact.metrics.length) {
      throw new Error("Duplicate impact metric in review pattern: " + id);
    }
    if (pattern.rollout.state === "disabled" && pattern.extractor !== null) {
      throw new Error("Disabled review pattern must not execute: " + id);
    }
    if (pattern.rollout.state !== "disabled" && pattern.extractor === null) {
      throw new Error("Running review pattern has no extractor: " + id);
    }
    for (const superseded of pattern.supersedes) {
      if (!ids.has(superseded as ReviewPatternId) || superseded === id) {
        throw new Error("Invalid review supersession from " + id + " to " + superseded);
      }
    }
  }
  return registry;
}

export const REVIEW_REGISTRY = validateReviewRegistry(reviewRegistryJson);

export const REVIEW_PATTERNS = PATTERN_IDS
  .map((id) => ({ id, pattern: REVIEW_REGISTRY.patterns[id] }))
  .sort((a, b) => a.pattern.order - b.pattern.order || a.id.localeCompare(b.id));

export type ReviewFactName =
  | "attempts"
  | "compactions"
  | "consecutive-errors"
  | "failed-checks"
  | "qualifying-turns"
  | "repeated-reads"
  | "retries-after-first-error"
  | "source-writes"
  | "triggering-attempts"
  | "window-turns";

export type ReviewEventImpact =
  | {
      role: "observed-window";
      tokens: TokenUsage;
      usd: number | null;
    }
  | {
      role: "same-token-reprice";
      tokens: TokenUsage;
      observedUsd: number;
      repricedUsd: number;
    };

export interface ReviewEvent {
  facts: Partial<Record<ReviewFactName, number>>;
  tools: string[];
  turnIndices: number[];
  /** Fixed internal overlap keys only; never exported. */
  overlapKeys: string[];
  /** Action indices whose observed attribution belongs to this event. */
  impactActionIndices: number[];
  impact?: ReviewEventImpact;
}

export interface ReviewExtractionContext {
  session: Session;
  actions: ReviewAction[];
  dataDir: string;
}

type ReviewExtractor = (
  context: ReviewExtractionContext,
  parameters: Record<string, unknown>,
) => Promise<ReviewEvent[]> | ReviewEvent[];

function actionKeys(actions: readonly ReviewAction[]): string[] {
  return actions.map((action) => "action:" + action.index);
}

function turnsOf(actions: readonly ReviewAction[]): number[] {
  return [...new Set(actions.map((action) => action.turnIndex))].sort((a, b) => a - b);
}

function toolsOf(actions: readonly ReviewAction[]): string[] {
  return [...new Set(actions.map((action) => action.tool).filter(Boolean))].sort();
}

const repeatedIdenticalAttempt: ReviewExtractor = (context) => {
  const events: ReviewEvent[] = [];
  let index = 0;
  while (index < context.actions.length) {
    const first = context.actions[index];
    if (!first.identityHash) {
      index++;
      continue;
    }
    let end = index + 1;
    while (end < context.actions.length && context.actions[end].identityHash === first.identityHash) {
      end++;
    }
    const run = context.actions.slice(index, end);
    if (run.length >= 3) {
      events.push({
        facts: { attempts: run.length, "triggering-attempts": run.length - 2 },
        tools: toolsOf(run),
        turnIndices: turnsOf(run),
        overlapKeys: actionKeys(run),
        impactActionIndices: run.slice(2).map((action) => action.index),
      });
    }
    index = end;
  }
  return events;
};

const repeatedIdenticalError: ReviewExtractor = (context) => {
  const events: ReviewEvent[] = [];
  const priorErrors = new Map<string, ReviewAction>();
  const matchedChainTail = new Map<string, number>();
  for (const action of context.actions) {
    if (action.outcome !== "error" || !action.identityHash) {
      continue;
    }
    const prior = priorErrors.get(action.identityHash);
    priorErrors.set(action.identityHash, action);
    if (!prior || action.index - prior.index > 10) {
      matchedChainTail.delete(action.identityHash);
      continue;
    }
    const between = context.actions.slice(prior.index + 1, action.index);
    if (between.some((candidate) => candidate.directWrite || candidate.validationSuccess)) {
      matchedChainTail.delete(action.identityHash);
      continue;
    }
    const continuesMatchedChain = matchedChainTail.get(action.identityHash) === prior.index;
    events.push({
      facts: { attempts: continuesMatchedChain ? 1 : 2, "retries-after-first-error": 1 },
      tools: toolsOf([prior, action]),
      turnIndices: turnsOf([prior, action]),
      overlapKeys: actionKeys([prior, action]),
      impactActionIndices: [action.index],
    });
    matchedChainTail.set(action.identityHash, action.index);
  }
  return events;
};

const consecutiveToolErrors: ReviewExtractor = (context) => {
  const events: ReviewEvent[] = [];
  let index = 0;
  while (index < context.actions.length) {
    if (context.actions[index].outcome !== "error") {
      index++;
      continue;
    }
    let end = index + 1;
    while (end < context.actions.length && context.actions[end].outcome === "error") {
      end++;
    }
    const run = context.actions.slice(index, end);
    if (run.length >= 3) {
      events.push({
        facts: { "consecutive-errors": run.length },
        tools: toolsOf(run),
        turnIndices: turnsOf(run),
        overlapKeys: actionKeys(run),
        impactActionIndices: run.map((action) => action.index),
      });
    }
    index = end;
  }
  return events;
};

const sameFileReread: ReviewExtractor = (context) => {
  const reads = new Map<string, ReviewAction[]>();
  const events: ReviewEvent[] = [];
  for (const action of context.actions) {
    for (const key of action.fileWriteKeys) {
      reads.delete(key);
    }
    let emitted = false;
    for (const key of action.fileReadKeys) {
      const recent = (reads.get(key) ?? []).filter((read) => action.index - read.index <= 10);
      recent.push(action);
      reads.set(key, recent);
      if (!emitted && recent.length >= 3) {
        const window = recent.slice(-3);
        events.push({
          facts: { "repeated-reads": 1 },
          tools: toolsOf(window),
          turnIndices: turnsOf(window),
          overlapKeys: actionKeys(window),
          impactActionIndices: [action.index],
        });
        emitted = true;
      }
    }
  }
  return events;
};

const lastChangeNotChecked: ReviewExtractor = (context) => {
  const sourceWrites = context.actions.filter((action) => action.sourceWrite);
  const finalWrite = sourceWrites[sourceWrites.length - 1];
  if (!finalWrite) {
    return [];
  }
  if (context.actions.slice(finalWrite.index + 1).some((action) => action.validationSuccess)) {
    return [];
  }
  const lastSuccessfulCheck = [...context.actions].reverse().find((action) => action.validationSuccess);
  const writesAfterLastCheck = sourceWrites.filter(
    (action) => !lastSuccessfulCheck || action.index > lastSuccessfulCheck.index,
  );
  return [
    {
      facts: { "source-writes": writesAfterLastCheck.length },
      tools: toolsOf(writesAfterLastCheck),
      turnIndices: turnsOf(writesAfterLastCheck),
      overlapKeys: ["tail-validation"],
      impactActionIndices: [],
    },
  ];
};

const lastCheckStillFailing: ReviewExtractor = (context) => {
  const lastByKey = new Map<string, ReviewAction>();
  for (const action of context.actions) {
    if (action.validationKey && (action.outcome === "ok" || action.outcome === "error")) {
      lastByKey.set(action.validationKey, action);
    }
  }
  return [...lastByKey.values()]
    .filter((action) => action.outcome === "error")
    .sort((a, b) => a.index - b.index)
    .map((action) => ({
      facts: { "failed-checks": 1 },
      tools: [action.tool].filter(Boolean),
      turnIndices: [action.turnIndex],
      overlapKeys: ["tail-validation", "validation:" + action.validationKey],
      impactActionIndices: [],
    }));
};

const contextRefillCluster: ReviewExtractor = async (context) => {
  const findings = await detectContextThrash(context.session, context.dataDir);
  return findings.map((finding) => ({
    facts: {
      compactions: finding.compactionCount,
      "window-turns": finding.turnIndices.length,
    },
    tools: [],
    turnIndices: finding.turnIndices,
    overlapKeys: finding.turnIndices.map((turn) => "turn:" + turn),
    impactActionIndices: [],
    impact: {
      role: "observed-window" as const,
      tokens: finding.tokens,
      usd: finding.usd,
    },
  }));
};

const shortToolFreeTurnCost: ReviewExtractor = async (context) => {
  const finding = await detectTrivialSpans(context.session, context.dataDir);
  if (!finding) {
    return [];
  }
  return [
    {
      facts: { "qualifying-turns": finding.eligibleTurnCount },
      tools: [],
      turnIndices: finding.turnIndices,
      overlapKeys: finding.turnIndices.map((turn) => "turn:" + turn),
      impactActionIndices: [],
      impact: {
        role: "same-token-reprice",
        tokens: finding.tokens,
        observedUsd: finding.observedUsd,
        repricedUsd: finding.repricedUsd,
      },
    },
  ];
};

const EXTRACTORS = {
  repeatedIdenticalAttemptV1: repeatedIdenticalAttempt,
  repeatedIdenticalErrorV1: repeatedIdenticalError,
  consecutiveToolErrorsV1: consecutiveToolErrors,
  sameFileRereadV2: sameFileReread,
  lastChangeNotCheckedV1: lastChangeNotChecked,
  lastCheckStillFailingV1: lastCheckStillFailing,
  contextRefillClusterV1: contextRefillCluster,
  shortToolFreeTurnCostV2: shortToolFreeTurnCost,
} satisfies Record<ExtractorId, ReviewExtractor>;

for (const { id, pattern } of REVIEW_PATTERNS) {
  if (pattern.extractor && !(pattern.extractor.id in EXTRACTORS)) {
    throw new Error("Missing review extractor implementation: " + id);
  }
}

export function hasRequiredCapabilities(
  pattern: ReviewPattern,
  available: ReadonlySet<RuntimeReviewCapability>,
): boolean {
  return pattern.requiredCapabilities.every((capability) => available.has(capability as RuntimeReviewCapability));
}

export async function extractReviewEvents(
  pattern: ReviewPattern,
  context: ReviewExtractionContext,
): Promise<ReviewEvent[]> {
  if (!pattern.extractor) {
    return [];
  }
  const extractor = EXTRACTORS[pattern.extractor.id];
  return extractor(context, pattern.extractor.parameters);
}
