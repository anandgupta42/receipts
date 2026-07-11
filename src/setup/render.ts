import { dottedLine, formatInt, formatUsdLowerBound, MIN_LEADER } from "../receipt/format.js";
import type { IntegrationRecipe } from "./integrations.js";
import { INTEGRATION_RECIPES, INTEGRATION_TARGETS } from "./integrations.js";
import type { SetupReport } from "./report.js";

const WIDTH = 58;

function costOrTokens(usd: number | null, tokens: number): string {
  return usd !== null ? formatUsdLowerBound(usd) : `${formatInt(tokens)} tok`;
}

function row(label: string, value: string): string {
  // Fall back to `label: value` whenever the dotted grid can't fit the full
  // label plus MIN_LEADER dots — dottedLine would truncate the label ("Sta…")
  // rather than move the value column (#192).
  if (value.startsWith(".") || label.length + value.length + MIN_LEADER > WIDTH) {
    return `${label}: ${value}`;
  }
  return dottedLine(label, value, WIDTH);
}

function scopeLabel(scope: "parent-session" | "parent-session-plus-readable-subagents"): string {
  return scope === "parent-session" ? "parent session only" : "parent + readable subagents";
}

export function renderSetupReport(report: SetupReport, noSessionMessage?: string): string {
  const lines: string[] = ["AIRECEIPTS SETUP", ""];

  lines.push("Found sessions");
  for (const agent of report.agents) {
    lines.push(`  ${row(agent.label, `${agent.sessionCount} sess`)}`);
  }

  if (!report.latest) {
    lines.push("");
    lines.push(noSessionMessage ?? "no agent session data detected.");
    lines.push("");
    lines.push("Next");
    lines.push("  Run a supported agent session, then run `npx aireceipts-cli setup` again.");
    lines.push("  See integration recipes with `npx aireceipts-cli integrations`.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("Latest session");
  lines.push(`  ${row("Agent", report.latest.label)}`);
  lines.push(`  ${row("Model", report.latest.model ?? "unknown")}`);
  const latestTotalLabel = report.latest.pricingCoverage === "partial"
    ? report.latest.subagentCount !== undefined
      ? `Known priced subtotal (incl. ${formatInt(report.latest.subagentCount)} subagents)`
      : "Known priced subtotal"
    : report.latest.subagentCount !== undefined
      ? `Total (incl. ${formatInt(report.latest.subagentCount)} subagents)`
      : "Total";
  lines.push(
    `  ${row(
      latestTotalLabel,
      costOrTokens(report.latest.totalUsd, report.latest.combinedTotalTokens ?? report.latest.totalTokens.total),
    )}`,
  );
  lines.push(`  ${row("Pricing coverage", report.latest.pricingCoverage)}`);
  lines.push(`  ${row("Cost scope", scopeLabel(report.latest.costScope))}`);
  lines.push(`  ${row("Token scope", scopeLabel(report.latest.tokenScope))}`);
  lines.push(`  ${row("Parent unpriced tokens", `${formatInt(report.latest.parentUnpricedTokens.total)} tok`)}`);
  lines.push(`  ${row("Known unpriced (combined)", `${formatInt(report.latest.combinedUnpricedTokens.total)} tok`)}`);
  if (report.latest.subagentRollupStatus === "unavailable") {
    lines.push(`  ${row("Subagent coverage", "unavailable · child counts/tokens unknown")}`);
  } else {
    const unpricedCount = report.latest.subagentUnpricedCount ?? 0;
    const unreadableCount = report.latest.subagentUnreadableCount ?? 0;
    const unreadableSuffix = unreadableCount > 0 ? " (tokens unknown)" : "";
    lines.push(
      `  ${row(
        "Subagent coverage",
        `${formatInt(report.latest.subagentCount ?? 0)} found · ${formatInt(unpricedCount)} unpriced · ${formatInt(unreadableCount)} unreadable${unreadableSuffix}`,
      )}`,
    );
  }
  lines.push(`  ${row("Flagged patterns", String(report.latest.wasteLineCount))}`);

  if (report.week) {
    lines.push("");
    lines.push("Trailing 7 days");
    lines.push(`  ${row("Sessions", String(report.week.sessionCount))}`);
    lines.push(
      `  ${row(
        `Priced floor (${report.week.fullyPricedSessionCount} full + ${report.week.partiallyPricedSessionCount} partial)`,
        report.week.pricedUsd !== null ? formatUsdLowerBound(report.week.pricedUsd) : "n/a",
      )}`,
    );
    if (report.week.cacheRatePartialSessionCount > 0) {
      lines.push(`  ${row("Cache-rate gaps", `${report.week.cacheRatePartialSessionCount} partial sess`)}`);
    }
    lines.push(
      `  ${row(
        "Pricing coverage",
        `${report.week.fullyPricedSessionCount} full · ${report.week.partiallyPricedSessionCount} partial · ${report.week.unpricedSessionCount} none`,
      )}`,
    );
    if (report.week.unreadableSessionCount > 0) {
      lines.push(`  ${row("Unreadable", `${report.week.unreadableSessionCount} sess`)}`);
    }
    if (report.week.unpricedTokenTotal.total > 0) {
      lines.push(`  ${row("Known unpriced tokens", `${formatInt(report.week.unpricedTokenTotal.total)} tok`)}`);
    }
    lines.push(`  ${row("Tokens (observable)", `${formatInt(report.week.tokenTotal.total)} tok`)}`);
    lines.push(`  ${row("Scope", "top-level only; children excluded")}`);
  }

  lines.push("");
  lines.push("Next");
  lines.push("  npx aireceipts-cli");
  lines.push("  npx aireceipts-cli week");
  lines.push("  npx aireceipts-cli integrations");
  lines.push("  npx aireceipts-cli install-hook");

  return lines.join("\n");
}

export function renderIntegrationMatrix(recipes: readonly IntegrationRecipe[] = INTEGRATION_RECIPES): string {
  const lines = ["AIRECEIPTS INTEGRATIONS", ""];
  for (const recipe of recipes) {
    lines.push(`${recipe.target}`);
    lines.push(`  ${row("Scope", recipe.scope)}`);
    lines.push(`  ${row("Status", recipe.status)}`);
    lines.push(`  ${row("Start", recipe.start)}`);
    lines.push(`  ${row("Network", recipe.network)}`);
    lines.push("");
  }
  lines.push(`Details: npx aireceipts-cli integrations <${INTEGRATION_TARGETS.join("|")}>`);
  return lines.join("\n");
}

export function renderIntegrationRecipe(recipe: IntegrationRecipe): string {
  return [
    `AIRECEIPTS INTEGRATION: ${recipe.label}`,
    "",
    row("Target", recipe.target),
    row("Status", recipe.status),
    row("Scope", recipe.scope),
    row("Network", recipe.network),
    row("Files changed", recipe.files.length > 0 ? recipe.files.join(", ") : "none"),
    row("Start", recipe.start),
    row("Undo", recipe.undo),
    "",
    "Snippet",
    recipe.snippet,
    "",
    "Notes",
    ...recipe.notes.map((note) => `  - ${note}`),
  ].join("\n");
}

export function integrationsToJson(recipes: readonly IntegrationRecipe[] = INTEGRATION_RECIPES) {
  return {
    schemaVersion: 1,
    targets: recipes.map((recipe) => ({
      target: recipe.target,
      label: recipe.label,
      status: recipe.status,
      scope: recipe.scope,
      network: recipe.network,
      files: recipe.files,
      start: recipe.start,
      undo: recipe.undo,
      snippet: recipe.snippet,
      notes: recipe.notes,
    })),
  };
}
