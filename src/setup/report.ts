import { buildWeekDigest } from "../aggregate/week.js";
import { listFullSessions, loadSession } from "../parse/load.js";
import { agentIds } from "../parse/registry.js";
import type { AgentSource, TokenUsage } from "../parse/types.js";
import { SOURCE_LABELS } from "../parse/types.js";
import { addUsage, emptyUsage } from "../parse/util.js";
import { combinedPricedUsd } from "../receipt/model.js";
import { combinedPricingCoverageOf, type PricingCoverage } from "../receipt/pricingCoverage.js";
import {
  buildFullSessionReceiptWithCoverage,
  type FullSessionScope,
  type SubagentRollupStatus,
} from "../receipt/subagents.js";
import { STANDARD_API_LOWER_BOUND_SEMANTICS } from "../receipt/costEstimate.js";
import { INTEGRATION_RECIPES, type IntegrationRecipe } from "./integrations.js";

export const SETUP_SCHEMA_VERSION = 1;

export interface SetupAgentRow {
  source: AgentSource;
  label: string;
  sessionCount: number;
  tokenTotal: TokenUsage;
}

export interface SetupLatest {
  source: AgentSource;
  label: string;
  model: string | null;
  totalUsd: number | null;
  pricingCoverage: PricingCoverage;
  totalTokens: TokenUsage;
  /** Observable parent-session tokens + readable-child tokens; unreadable children remain count-only. */
  combinedTotalTokens?: number;
  subagentCount?: number;
  parentUnpricedTokens: TokenUsage;
  /** Exact known-unpriced parent + readable-child usage; unreadable child tokens are unknowable and excluded. */
  combinedUnpricedTokens: TokenUsage;
  subagentUnpricedCount: number | null;
  subagentUnreadableCount: number | null;
  subagentRollupStatus: SubagentRollupStatus;
  costScope: FullSessionScope;
  tokenScope: FullSessionScope;
  wasteLineCount: number;
  unpriceable: boolean;
}

export interface SetupWeek {
  sessionCount: number;
  pricedSessionCount: number;
  excludedSessionCount: number;
  fullyPricedSessionCount: number;
  partiallyPricedSessionCount: number;
  cacheRatePartialSessionCount: number;
  unpricedSessionCount: number;
  unreadableSessionCount: number;
  unpricedTokenTotal: TokenUsage;
  pricedUsd: number | null;
  tokenTotal: TokenUsage;
  childSessionsIncluded: false;
}

export interface SetupOffer {
  target: IntegrationRecipe["target"];
  label: string;
  scope: IntegrationRecipe["scope"];
  network: string;
  start: string;
}

export interface SetupReport {
  schemaVersion: typeof SETUP_SCHEMA_VERSION;
  status: "ready" | "no_sessions";
  agents: SetupAgentRow[];
  latest: SetupLatest | null;
  week: SetupWeek | null;
  offers: SetupOffer[];
}

function usageJson(t: TokenUsage) {
  return {
    input: t.input,
    output: t.output,
    cacheRead: t.cacheRead,
    cacheCreation: t.cacheCreation,
    cacheCreation5m: t.cacheCreation5m ?? null,
    cacheCreation1h: t.cacheCreation1h ?? null,
    total: t.total,
  };
}

function agentRows(summaries: Awaited<ReturnType<typeof listFullSessions>>): SetupAgentRow[] {
  return agentIds().map((source) => {
    const rows = summaries.filter((summary) => summary.source === source);
    const tokenTotal = rows.reduce((acc, summary) => addUsage(acc, summary.totals.tokens), emptyUsage());
    return {
      source,
      label: SOURCE_LABELS[source],
      sessionCount: rows.length,
      tokenTotal,
    };
  });
}

function offers(): SetupOffer[] {
  return INTEGRATION_RECIPES.map((recipe) => ({
    target: recipe.target,
    label: recipe.label,
    scope: recipe.scope,
    network: recipe.network,
    start: recipe.start,
  }));
}

export async function buildSetupReport(now: number = Date.now()): Promise<SetupReport> {
  const summaries = await listFullSessions();
  const agents = agentRows(summaries);

  if (summaries.length === 0) {
    return {
      schemaVersion: SETUP_SCHEMA_VERSION,
      status: "no_sessions",
      agents,
      latest: null,
      week: null,
      offers: offers(),
    };
  }

  const latestSummary = summaries[0];
  const [latestSession, weekDigest] = await Promise.all([loadSession(latestSummary), buildWeekDigest({ now })]);
  const latestReceipt = latestSession ? await buildFullSessionReceiptWithCoverage(latestSession) : null;
  const latest: SetupLatest | null =
    latestSession && latestReceipt
      ? {
          source: latestSession.source,
          label: SOURCE_LABELS[latestSession.source],
          model: latestSession.model ?? null,
          totalUsd: combinedPricedUsd(latestReceipt.model),
          pricingCoverage: combinedPricingCoverageOf(latestReceipt.model),
          totalTokens: latestReceipt.model.sessionTotalTokens,
          ...(latestReceipt.model.subagents
            ? {
                combinedTotalTokens: latestReceipt.model.sessionTotalTokens.total + latestReceipt.model.subagents.tokensTotal,
                subagentCount: latestReceipt.model.subagents.count,
              }
            : {}),
          parentUnpricedTokens: latestReceipt.coverage.parentUnpricedTokens,
          combinedUnpricedTokens: latestReceipt.coverage.combinedUnpricedTokens,
          subagentUnpricedCount: latestReceipt.coverage.subagentUnpricedCount,
          subagentUnreadableCount: latestReceipt.coverage.subagentUnreadableCount,
          subagentRollupStatus: latestReceipt.coverage.subagentRollupStatus,
          costScope: latestReceipt.coverage.costScope,
          tokenScope: latestReceipt.coverage.tokenScope,
          wasteLineCount: latestReceipt.model.wasteLines.length,
          unpriceable: latestReceipt.model.unpriceable,
        }
      : null;

  return {
    schemaVersion: SETUP_SCHEMA_VERSION,
    status: "ready",
    agents,
    latest,
    week: {
      sessionCount: weekDigest.current.sessionCount,
      pricedSessionCount: weekDigest.current.pricedSessionCount,
      excludedSessionCount: weekDigest.current.excludedSessionCount,
      fullyPricedSessionCount: weekDigest.current.fullyPricedSessionCount,
      partiallyPricedSessionCount: weekDigest.current.partiallyPricedSessionCount,
      cacheRatePartialSessionCount: weekDigest.current.cacheRatePartialSessionCount,
      unpricedSessionCount: weekDigest.current.unpricedSessionCount,
      unreadableSessionCount: weekDigest.current.unreadableSessionCount,
      unpricedTokenTotal: weekDigest.current.unpricedTokenTotal,
      pricedUsd: weekDigest.current.pricedUsd,
      tokenTotal: weekDigest.current.tokenTotal,
      childSessionsIncluded: false,
    },
    offers: offers(),
  };
}

export function setupReportToJson(report: SetupReport) {
  return {
    schemaVersion: report.schemaVersion,
    costSemantics: STANDARD_API_LOWER_BOUND_SEMANTICS,
    status: report.status,
    agents: report.agents.map((agent) => ({
      source: agent.source,
      label: agent.label,
      sessionCount: agent.sessionCount,
      tokenTotal: usageJson(agent.tokenTotal),
    })),
    latest: report.latest
      ? {
          source: report.latest.source,
          label: report.latest.label,
          model: report.latest.model,
          totalUsd: report.latest.totalUsd,
          pricingCoverage: report.latest.pricingCoverage,
          totalTokens: usageJson(report.latest.totalTokens),
          parentUnpricedTokens: usageJson(report.latest.parentUnpricedTokens),
          combinedUnpricedTokens: usageJson(report.latest.combinedUnpricedTokens),
          subagentUnpricedCount: report.latest.subagentUnpricedCount,
          subagentUnreadableCount: report.latest.subagentUnreadableCount,
          subagentRollupStatus: report.latest.subagentRollupStatus,
          costScope: report.latest.costScope,
          tokenScope: report.latest.tokenScope,
          ...(report.latest.subagentCount !== undefined
            ? {
                combinedTotalTokens: report.latest.combinedTotalTokens,
                subagentCount: report.latest.subagentCount,
                /** Compatibility alias; costScope/tokenScope carry the explicit split. */
                totalScope: report.latest.tokenScope,
              }
            : {}),
          wasteLineCount: report.latest.wasteLineCount,
          unpriceable: report.latest.unpriceable,
        }
      : null,
    week: report.week
      ? {
          sessionCount: report.week.sessionCount,
          pricedSessionCount: report.week.pricedSessionCount,
          excludedSessionCount: report.week.excludedSessionCount,
          pricingCoverage: {
            fullyPricedSessionCount: report.week.fullyPricedSessionCount,
            partiallyPricedSessionCount: report.week.partiallyPricedSessionCount,
            cacheRatePartialSessionCount: report.week.cacheRatePartialSessionCount,
            unpricedSessionCount: report.week.unpricedSessionCount,
            unreadableSessionCount: report.week.unreadableSessionCount,
            unpricedTokenTotal: usageJson(report.week.unpricedTokenTotal),
          },
          pricedUsd: report.week.pricedUsd,
          tokenTotal: usageJson(report.week.tokenTotal),
          scope: { childSessionsIncluded: report.week.childSessionsIncluded },
        }
      : null,
    offers: report.offers.map((offer) => ({
      target: offer.target,
      label: offer.label,
      scope: offer.scope,
      network: offer.network,
      start: offer.start,
    })),
  };
}
