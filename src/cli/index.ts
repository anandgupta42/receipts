// R6 CLI dispatcher. Delegates session lookup/selection to the already-shipped
// `listSessions`/`selectSummary`/`loadSession` (parse layer, core-engine's) —
// no selector logic is reimplemented here.
import { writeFile } from "node:fs/promises";
import { anyDetected, listSessions, loadSession, rootsHint, selectSummary } from "../index.js";
import type { SessionSummary } from "../parse/types.js";
import { evaluateBudget } from "../budget/index.js";
import { renderCompare, compareDeltaLine } from "../receipt/compare.js";
import { renderHandoff } from "../receipt/handoff.js";
import { formatAbsoluteUtc, formatInt } from "../receipt/format.js";
import { summaryToJson, toJsonModel } from "../receipt/json.js";
import { buildReceiptModel } from "../receipt/model.js";
import { renderReceipt } from "../receipt/render.js";
import { renderReceiptSvg, renderCompareSvg } from "../receipt/svg.js";
import { renderWeek, weekToJson } from "../receipt/week.js";
import { buildWeekDigest } from "../aggregate/week.js";
import { METHODOLOGY } from "../pricing/attribution.js";
import {
  ensureFirstRunNotice,
  flushTelemetry,
  recordCliError,
  recordCliRun,
  showTelemetryPayload,
} from "../telemetry/index.js";
import { buildBenchmarkPayload, confirmPrompt, BENCHMARK_UNAVAILABLE_MESSAGE } from "../benchmark/index.js";
import { parseArgs } from "./args.js";
import { runQuota } from "./quota.js";

const HELP_TEXT = `aireceipts — local, deterministic cost receipts for AI coding-agent sessions

Usage:
  aireceipts [selector] [--json]        print a receipt (default: newest session)
  aireceipts --list [--json]            list sessions, newest first
  aireceipts compare <a> <b> [--json]   side-by-side (or stacked) comparison
  aireceipts --handoff [selector]       paste-ready block of fired waste lines
  aireceipts --quota                    current Claude Code rate-limit window usage
                                         (statusline stdin mode only; silent if unavailable)
  aireceipts [selector] --svg [-o f]    write a shareable SVG receipt (default receipt.svg)
  aireceipts compare <a> <b> --svg      write a side-by-side SVG (default compare.svg)
  aireceipts week [--by-project] [--since <date>] [--json]
                                        trailing-7-day digest across sessions
  aireceipts --check-budget             exit 1 if ~/.aireceipts/budget.json's cap is
                                         exceeded (advisory; see docs)
  aireceipts benchmark [--dry-run]      opt-in cost-per-turn benchmark (v1: client
                                         contract only, sends disabled)
  aireceipts --help                     show this help

flags: --svg renders an SVG file; --theme light|dark picks the palette (default light);
       -o/--output names the file.
selector: a 1-based index into --list, a session id, or a title substring.`;

interface SvgOut {
  svg: boolean;
  theme: "light" | "dark";
  output?: string;
}

async function writeSvg(svg: string, path: string): Promise<void> {
  await writeFile(path, svg, "utf8");
  process.stdout.write(`wrote ${path} (${Buffer.byteLength(svg)} bytes)\n`);
}

async function noSessionsMessage(): Promise<string> {
  if (!(await anyDetected())) {
    return `no agent session data detected. Looked in:\n${rootsHint()}`;
  }
  return "no sessions found";
}

async function resolveSelector(selector: string | undefined): Promise<{ summary: SessionSummary } | { error: string }> {
  const sessions = await listSessions();
  if (sessions.length === 0) {
    return { error: await noSessionsMessage() };
  }
  const summary = selectSummary(sessions, selector);
  if (!summary) {
    return { error: `no session matched "${selector}"` };
  }
  return { summary };
}

async function runReceipt(selector: string | undefined, json: boolean, svgOut: SvgOut): Promise<number> {
  const resolved = await resolveSelector(selector);
  if ("error" in resolved) {
    process.stderr.write(`${resolved.error}\n`);
    return 1;
  }
  const session = await loadSession(resolved.summary);
  if (!session) {
    process.stderr.write(`failed to load session "${resolved.summary.id}"\n`);
    return 1;
  }
  const model = await buildReceiptModel(session);
  if (svgOut.svg) {
    await writeSvg(renderReceiptSvg(model, { theme: svgOut.theme }), svgOut.output ?? "receipt.svg");
    return 0;
  }
  // R1/R5: absent or malformed budget.json → `lines` is [] → output below is
  // byte-identical to pre-SPEC-0009 (goldens gate this). Malformed only adds
  // a stderr note, never a rendered line.
  const budget = await evaluateBudget(Date.now());
  if (budget.status === "invalid") {
    process.stderr.write(`budget.json ignored: ${budget.invalidReason}\n`);
  }
  if (json) {
    const jsonModel = toJsonModel(model);
    const withBudget = budget.lines.length > 0 ? { ...jsonModel, budget: budget.lines } : jsonModel;
    process.stdout.write(`${JSON.stringify(withBudget, null, 2)}\n`);
  } else {
    const budgetSuffix = budget.lines.length > 0 ? `\n\n${budget.lines.join("\n")}` : "";
    process.stdout.write(`${renderReceipt(model)}${budgetSuffix}\n`);
  }
  return 0;
}

async function runCheckBudget(): Promise<number> {
  const budget = await evaluateBudget(Date.now());
  if (budget.status === "invalid") {
    process.stderr.write(`budget.json ignored: ${budget.invalidReason}\n`);
    return 0;
  }
  if (budget.status === "absent") {
    return 0;
  }
  for (const line of budget.lines) {
    process.stdout.write(`${line}\n`);
  }
  return budget.exceeded ? 1 : 0;
}

function listLine(index: number, summary: SessionSummary): string {
  const start = summary.startedAt !== undefined ? formatAbsoluteUtc(summary.startedAt) : "start time unknown";
  const label = summary.title ?? summary.id;
  return `${index + 1}. [${summary.source}] ${label}  ·  ${start}  ·  ${formatInt(summary.totals.toolCallCount)} tool calls`;
}

async function runList(json: boolean): Promise<number> {
  const sessions = await listSessions();
  if (sessions.length === 0) {
    process.stdout.write(`${await noSessionsMessage()}\n`);
    return 0;
  }
  if (json) {
    process.stdout.write(`${JSON.stringify(sessions.map(summaryToJson), null, 2)}\n`);
  } else {
    process.stdout.write(`${sessions.map((s, i) => listLine(i, s)).join("\n")}\n`);
  }
  return 0;
}

async function runCompare(
  selectorA: string | undefined,
  selectorB: string | undefined,
  json: boolean,
  svgOut: SvgOut,
): Promise<number> {
  if (!selectorA || !selectorB) {
    process.stderr.write("compare requires two selectors: aireceipts compare <a> <b>\n");
    return 1;
  }
  const sessions = await listSessions();
  if (sessions.length === 0) {
    process.stderr.write(`${await noSessionsMessage()}\n`);
    return 1;
  }
  const summaryA = selectSummary(sessions, selectorA);
  const summaryB = selectSummary(sessions, selectorB);
  if (!summaryA) {
    process.stderr.write(`no session matched "${selectorA}"\n`);
    return 1;
  }
  if (!summaryB) {
    process.stderr.write(`no session matched "${selectorB}"\n`);
    return 1;
  }
  const [sessionA, sessionB] = await Promise.all([loadSession(summaryA), loadSession(summaryB)]);
  if (!sessionA || !sessionB) {
    process.stderr.write("failed to load one or both sessions\n");
    return 1;
  }
  const [modelA, modelB] = await Promise.all([buildReceiptModel(sessionA), buildReceiptModel(sessionB)]);
  if (svgOut.svg) {
    await writeSvg(renderCompareSvg(modelA, modelB, { theme: svgOut.theme }), svgOut.output ?? "compare.svg");
  } else if (json) {
    process.stdout.write(
      `${JSON.stringify(
        { a: toJsonModel(modelA), b: toJsonModel(modelB), delta: compareDeltaLine(modelA, modelB) },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write(`${renderCompare(modelA, modelB)}\n`);
  }
  return 0;
}

async function runHandoff(selector: string | undefined): Promise<number> {
  const resolved = await resolveSelector(selector);
  if ("error" in resolved) {
    process.stderr.write(`${resolved.error}\n`);
    return 1;
  }
  const session = await loadSession(resolved.summary);
  if (!session) {
    process.stderr.write(`failed to load session "${resolved.summary.id}"\n`);
    return 1;
  }
  const model = await buildReceiptModel(session);
  process.stdout.write(`${renderHandoff(model)}\n`);
  return 0;
}

async function runWeek(args: ReturnType<typeof parseArgs>): Promise<number> {
  let sinceMs: number | undefined;
  if (args.since !== undefined) {
    const parsed = Date.parse(args.since);
    if (Number.isNaN(parsed)) {
      process.stderr.write(`invalid --since date: "${args.since}"\n`);
      return 1;
    }
    sinceMs = parsed;
  }
  const digest = await buildWeekDigest({ sinceMs, byProject: args.byProject });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(weekToJson(digest), null, 2)}\n`);
  } else {
    process.stdout.write(`${renderWeek(digest)}\n`);
  }
  return 0;
}

/**
 * SPEC-0015 v1: client contract only, sends disabled.
 * `--dry-run` builds+prints the exact payload and returns without prompting
 * (R3). Otherwise every call re-prompts `[y/N]` (R1, no persisted
 * "always allow") — declining makes no network call and exits 0; accepting
 * also makes no network call in v1, since no server endpoint exists yet
 * (`isBenchmarkServiceAvailable()` is always `false` — see src/benchmark/send.ts).
 */
async function runBenchmark(selector: string | undefined, dryRun: boolean): Promise<number> {
  const resolved = await resolveSelector(selector);
  if ("error" in resolved) {
    process.stderr.write(`${resolved.error}\n`);
    return 1;
  }
  const session = await loadSession(resolved.summary);
  if (!session) {
    process.stderr.write(`failed to load session "${resolved.summary.id}"\n`);
    return 1;
  }
  const model = await buildReceiptModel(session);
  const payload = buildBenchmarkPayload(model, session.totals.turnCount);

  if (dryRun) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  const consented = await confirmPrompt("Send anonymous benchmark data for this session?");
  if (!consented) {
    return 0;
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write(`${BENCHMARK_UNAVAILABLE_MESSAGE}\n`);
  return 0;
}

async function dispatch(args: ReturnType<typeof parseArgs>): Promise<number> {
  const svgOut: SvgOut = { svg: args.svg, theme: args.theme, output: args.output };
  switch (args.command) {
    case "telemetry-show":
      process.stdout.write(JSON.stringify(showTelemetryPayload(process.env), null, 2) + "\n");
      return 0;
    case "methodology":
      process.stdout.write(METHODOLOGY + "\n");
      return 0;
    case "help":
      process.stdout.write(`${HELP_TEXT}\n`);
      return 0;
    case "list":
      return runList(args.json);
    case "compare":
      return runCompare(args.compareA, args.compareB, args.json, svgOut);
    case "handoff":
      return runHandoff(args.selector);
    case "quota":
      return runQuota();
    case "week":
      return runWeek(args);
    case "check-budget":
      return runCheckBudget();
    case "benchmark":
      return runBenchmark(args.selector, args.dryRun);
    case "receipt":
    default:
      return runReceipt(args.selector, args.json, svgOut);
  }
}

/** CLI entrypoint: first-run notice → dispatch → telemetry record → bounded flush (SPEC-0002 wiring). */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (args.command !== "telemetry-show") {
    await ensureFirstRunNotice((text) => process.stderr.write(text + "\n"), undefined);
  }
  const started = Date.now();
  try {
    const code = await dispatch(args);
    recordCliRun({ command: args.command, agentType: undefined, durationMs: Date.now() - started, ok: code === 0 });
    return code;
  } catch (err) {
    recordCliError({ command: args.command, agentType: undefined, err });
    process.stderr.write(String(err instanceof Error ? err.message : err) + "\n");
    return 1;
  } finally {
    await flushTelemetry();
  }
}
