import { buildWeekDigest } from "../aggregate/week.js";
import { listFullSessions, loadSession } from "../parse/load.js";
import { agentIds } from "../parse/registry.js";
import type { AgentSource, TokenUsage } from "../parse/types.js";
import { SOURCE_LABELS } from "../parse/types.js";
import { addUsage, emptyUsage } from "../parse/util.js";
import { buildReceiptModel } from "../receipt/model.js";
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
  totalTokens: TokenUsage;
  wasteLineCount: number;
  unpriceable: boolean;
}

export interface SetupWeek {
  sessionCount: number;
  pricedSessionCount: number;
  excludedSessionCount: number;
  pricedUsd: number | null;
  tokenTotal: TokenUsage;
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
  const latestModel = latestSession ? await buildReceiptModel(latestSession) : null;
  const latest: SetupLatest | null =
    latestSession && latestModel
      ? {
          source: latestSession.source,
          label: SOURCE_LABELS[latestSession.source],
          model: latestSession.model ?? null,
          totalUsd: latestModel.totalUsd,
          totalTokens: latestModel.sessionTotalTokens,
          wasteLineCount: latestModel.wasteLines.length,
          unpriceable: latestModel.unpriceable,
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
      pricedUsd: weekDigest.current.pricedUsd,
      tokenTotal: weekDigest.current.tokenTotal,
    },
    offers: offers(),
  };
}

export function setupReportToJson(report: SetupReport) {
  return {
    schemaVersion: report.schemaVersion,
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
          totalTokens: usageJson(report.latest.totalTokens),
          wasteLineCount: report.latest.wasteLineCount,
          unpriceable: report.latest.unpriceable,
        }
      : null,
    week: report.week
      ? {
          sessionCount: report.week.sessionCount,
          pricedSessionCount: report.week.pricedSessionCount,
          excludedSessionCount: report.week.excludedSessionCount,
          pricedUsd: report.week.pricedUsd,
          tokenTotal: usageJson(report.week.tokenTotal),
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
