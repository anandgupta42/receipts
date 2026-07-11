// R7 weekly-digest surfaces: a compact text table and a stable-key-order JSON
// (the JSON feeds SPEC-0011's export surfaces). Pure formatting over a
// `WeekDigest` — no aggregation or pricing logic here. Honesty carries through
// from the model: a `$` renders only against a priced total; tokens render for
// every session; deltas render per category, never blended.
import type { AgentSplit, ProjectSplit, WeekDigest, WindowAggregate } from "../aggregate/week.js";
import type { WasteClassAggregate } from "../aggregate/waste.js";
import type { TokenUsage } from "../parse/types.js";
import { colorEnabled, makeColorizer } from "./color.js";
import { center, dottedLine, formatDateUtc, formatInt, formatUsd, formatUsdFloor, formatUsdLowerBound } from "./format.js";
import { INSTALL_FOOTER_TEXT, REPOSITORY_DISPLAY } from "./branding.js";
import {
  HEURISTIC_PATTERN_PRICING_INTERPRETATION,
  STANDARD_API_LOWER_BOUND_SEMANTICS,
} from "./costEstimate.js";

const WIDTH = 50;
const INNER = WIDTH - 2;

export interface RenderWeekOptions {
  color?: boolean;
}

function signedUsd(n: number): string {
  return `${n >= 0 ? "+" : "-"}$${formatUsd(Math.abs(n))}`;
}

function signedInt(n: number): string {
  return `${n >= 0 ? "+" : "-"}${formatInt(Math.abs(n))}`;
}

/**
 * Plain-language direction for a delta so a signed figure reads without knowing
 * the current−prior convention: against the "vs. prior 7 days" header, does this
 * week land higher or lower? A bare `-3,315,784,772` can't say whether tokens
 * went up or down; `(fewer)` does. Zero → "flat".
 */
function trend(n: number, more: string, less: string): string {
  if (n > 0) {
    return more;
  }
  if (n < 0) {
    return less;
  }
  return "flat";
}

/** A priced bucket renders `$`; an unpriced bucket falls back to tokens (mirrors the receipt's tokens-only mode). */
function splitValue(usd: number | null, tokens: TokenUsage, sessionCount: number): string {
  const magnitude = usd !== null ? formatUsdLowerBound(usd) : `${formatInt(tokens.total)} tok`;
  return `${magnitude} · ${sessionCount} sess`;
}

function wasteValue(waste: WasteClassAggregate): string {
  const magnitude = waste.cost > 0 ? `≈ $${formatUsdFloor(waste.cost)}` : `≈ ${formatInt(waste.tokens.total)} tok`;
  const unit = waste.distinctSessionCount === 1 ? "session" : "sessions";
  return `${magnitude} · ${waste.distinctSessionCount} ${unit}`;
}

function indented(label: string, value: string): string {
  return `  ${dottedLine(label, value, INNER)}`;
}

function windowBody(window: WindowAggregate): string[] {
  const lines: string[] = [];
  lines.push(dottedLine("Sessions", String(window.sessionCount), WIDTH));

  const pricedLabel = `Priced floor (${window.fullyPricedSessionCount} full + ${window.partiallyPricedSessionCount} partial)`;
  const pricedValue = window.pricedUsd !== null ? formatUsdLowerBound(window.pricedUsd) : "n/a";
  lines.push(dottedLine(pricedLabel, pricedValue, WIDTH));

  const coverage = `${window.fullyPricedSessionCount} full · ${window.partiallyPricedSessionCount} partial · ${window.unpricedSessionCount} none`;
  lines.push(dottedLine("Pricing coverage", coverage, WIDTH));
  if (window.cacheRatePartialSessionCount > 0) {
    lines.push(dottedLine("Cache-rate gaps", `${window.cacheRatePartialSessionCount} partial sess`, WIDTH));
  }
  if (window.unreadableSessionCount > 0) {
    lines.push(dottedLine("Unreadable", `${window.unreadableSessionCount} sess`, WIDTH));
  }
  if (window.unpricedTokenTotal.total > 0) {
    lines.push(dottedLine("Known unpriced tokens", `${formatInt(window.unpricedTokenTotal.total)} tok`, WIDTH));
  }

  lines.push(dottedLine("Tokens (observable)", `${formatInt(window.tokenTotal.total)} tok`, WIDTH));
  lines.push(dottedLine("Scope", "top-level only; children excluded", WIDTH));

  if (window.byAgent.length > 0) {
    lines.push("");
    lines.push("By agent");
    for (const agent of window.byAgent as AgentSplit[]) {
      lines.push(indented(agent.label, splitValue(agent.usd, agent.tokens, agent.sessionCount)));
    }
  }

  if (window.byProject && window.byProject.length > 0) {
    lines.push("");
    lines.push("By project");
    for (const project of window.byProject as ProjectSplit[]) {
      lines.push(indented(project.project, splitValue(project.usd, project.tokens, project.sessionCount)));
    }
  }

  return lines;
}

function deltaBody(digest: WeekDigest): string[] {
  const { delta } = digest;
  const header = `vs. prior 7 days (${formatDateUtc(digest.priorStartMs)} → ${formatDateUtc(digest.priorEndMs)})`;
  const lines = ["", header];
  if (!delta.hasPrior) {
    lines.push("  no prior data");
    return lines;
  }
  const usdValue =
    delta.pricedUsdDelta !== null
      ? `${signedUsd(delta.pricedUsdDelta)} (${trend(delta.pricedUsdDelta, "more", "less")})`
      : "n/a (priced coverage differs)";
  lines.push(indented("Priced floor Δ", delta.pricedUsdDelta !== null ? `≈ ${usdValue}` : usdValue));
  lines.push(indented("Tokens Δ", `${signedInt(delta.tokenDelta)} tok (${trend(delta.tokenDelta, "more", "fewer")})`));
  lines.push(indented("Excluded", `${delta.currentExcluded} now / ${delta.priorExcluded} prior`));
  return lines;
}

/** Render `digest` as the text table (R7). Byte-stable: no locale/`Intl`, fixed UTC dates, fixed comma grouping. */
export function renderWeek(digest: WeekDigest, opts: RenderWeekOptions = {}): string {
  const enabled = opts.color ?? colorEnabled();
  const { dim, bold } = makeColorizer(enabled);
  const lines: string[] = [];

  lines.push(center(bold("WEEKLY DIGEST"), WIDTH));
  const span = `${formatDateUtc(digest.windowStartMs)} → ${formatDateUtc(digest.windowEndMs)}`;
  const scope = digest.sinceOverride ? "since override" : "trailing 7 days";
  lines.push(center(`${span} · ${scope}`, WIDTH));
  lines.push("");

  lines.push(...windowBody(digest.current));

  if (digest.topWaste.length > 0) {
    lines.push("");
    lines.push("Flagged patterns");
    for (const waste of digest.topWaste) {
      lines.push(indented(waste.class, wasteValue(waste)));
    }
    lines.push("  heuristic pattern cost · standard API floor · not proven savings");
  }

  lines.push(...deltaBody(digest));

  lines.push(dim("-".repeat(WIDTH)));
  lines.push(center(INSTALL_FOOTER_TEXT, WIDTH));
  lines.push(center(REPOSITORY_DISPLAY, WIDTH));

  return lines.join("\n");
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

function agentJson(a: AgentSplit) {
  return { source: a.source, label: a.label, usd: a.usd, tokens: usageJson(a.tokens), sessionCount: a.sessionCount };
}

function projectJson(p: ProjectSplit) {
  return { project: p.project, usd: p.usd, tokens: usageJson(p.tokens), sessionCount: p.sessionCount };
}

function wasteJson(w: WasteClassAggregate) {
  return {
    class: w.class,
    costInterpretation: w.costInterpretation ?? HEURISTIC_PATTERN_PRICING_INTERPRETATION,
    cost: w.cost,
    tokens: usageJson(w.tokens),
    distinctSessionCount: w.distinctSessionCount,
  };
}

function windowJson(window: WindowAggregate) {
  return {
    sessionCount: window.sessionCount,
    pricedSessionCount: window.pricedSessionCount,
    excludedSessionCount: window.excludedSessionCount,
    pricingCoverage: {
      fullyPricedSessionCount: window.fullyPricedSessionCount,
      partiallyPricedSessionCount: window.partiallyPricedSessionCount,
      cacheRatePartialSessionCount: window.cacheRatePartialSessionCount,
      unpricedSessionCount: window.unpricedSessionCount,
      unreadableSessionCount: window.unreadableSessionCount,
      unpricedTokenTotal: usageJson(window.unpricedTokenTotal),
    },
    pricedUsd: window.pricedUsd,
    tokenTotal: usageJson(window.tokenTotal),
    byAgent: window.byAgent.map(agentJson),
    byProject: window.byProject ? window.byProject.map(projectJson) : null,
    waste: window.waste.map(wasteJson),
  };
}

/** Full structured digest for `--json` — fixed key order (the schema SPEC-0011 consumes). */
export function weekToJson(digest: WeekDigest) {
  return {
    costSemantics: STANDARD_API_LOWER_BOUND_SEMANTICS,
    scope: { childSessionsIncluded: false },
    window: { startMs: digest.windowStartMs, endMs: digest.windowEndMs },
    priorWindow: { startMs: digest.priorStartMs, endMs: digest.priorEndMs },
    sinceOverride: digest.sinceOverride,
    byProject: digest.byProject,
    current: windowJson(digest.current),
    prior: windowJson(digest.prior),
    delta: {
      hasPrior: digest.delta.hasPrior,
      pricedUsdDelta: digest.delta.pricedUsdDelta,
      pricedUsdDeltaKind: digest.delta.pricedUsdDelta === null ? null : "difference-of-lower-bounds" as const,
      tokenDelta: digest.delta.tokenDelta,
      currentExcluded: digest.delta.currentExcluded,
      priorExcluded: digest.delta.priorExcluded,
    },
    topWaste: digest.topWaste.map(wasteJson),
  };
}
