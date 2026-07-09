import { dottedLine, formatInt, formatUsd, MIN_LEADER } from "../receipt/format.js";
import type { IntegrationRecipe } from "./integrations.js";
import { INTEGRATION_RECIPES, INTEGRATION_TARGETS } from "./integrations.js";
import type { SetupReport } from "./report.js";

const WIDTH = 58;

function costOrTokens(usd: number | null, tokens: number): string {
  return usd !== null ? `$${formatUsd(usd)}` : `${formatInt(tokens)} tok`;
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
  lines.push(`  ${row("Total", costOrTokens(report.latest.totalUsd, report.latest.totalTokens.total))}`);
  lines.push(`  ${row("Waste lines", String(report.latest.wasteLineCount))}`);

  if (report.week) {
    lines.push("");
    lines.push("Trailing 7 days");
    lines.push(`  ${row("Sessions", String(report.week.sessionCount))}`);
    lines.push(
      `  ${row(
        `Priced total (${report.week.pricedSessionCount} of ${report.week.sessionCount})`,
        report.week.pricedUsd !== null ? `$${formatUsd(report.week.pricedUsd)}` : "n/a",
      )}`,
    );
    lines.push(`  ${row("Tokens (all sessions)", `${formatInt(report.week.tokenTotal.total)} tok`)}`);
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
