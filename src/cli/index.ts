// R6 CLI dispatcher. Delegates session lookup/selection to the already-shipped
// `listSessions`/`selectSummary`/`loadSession` (parse layer, core-engine's) —
// no selector logic is reimplemented here.
import { anyDetected, listSessions, loadSession, rootsHint, selectSummary } from "../index.js";
import type { SessionSummary } from "../parse/types.js";
import { renderCompare, compareDeltaLine } from "../receipt/compare.js";
import { renderHandoff } from "../receipt/handoff.js";
import { formatAbsoluteUtc, formatInt } from "../receipt/format.js";
import { summaryToJson, toJsonModel } from "../receipt/json.js";
import { buildReceiptModel } from "../receipt/model.js";
import { renderReceipt } from "../receipt/render.js";
import { METHODOLOGY } from "../pricing/attribution.js";
import {
  ensureFirstRunNotice,
  flushTelemetry,
  recordCliError,
  recordCliRun,
  showTelemetryPayload,
} from "../telemetry/index.js";
import { parseArgs } from "./args.js";

const HELP_TEXT = `aireceipts — local, deterministic cost receipts for AI coding-agent sessions

Usage:
  aireceipts [selector] [--json]        print a receipt (default: newest session)
  aireceipts --list [--json]            list sessions, newest first
  aireceipts compare <a> <b> [--json]   side-by-side (or stacked) comparison
  aireceipts --handoff [selector]       paste-ready block of fired waste lines
  aireceipts --help                     show this help

selector: a 1-based index into --list, a session id, or a title substring.`;

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

async function runReceipt(selector: string | undefined, json: boolean): Promise<number> {
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
  if (json) {
    process.stdout.write(`${JSON.stringify(toJsonModel(model), null, 2)}\n`);
  } else {
    process.stdout.write(`${renderReceipt(model)}\n`);
  }
  return 0;
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

async function runCompare(selectorA: string | undefined, selectorB: string | undefined, json: boolean): Promise<number> {
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
  if (json) {
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

async function dispatch(args: ReturnType<typeof parseArgs>): Promise<number> {
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
      return runCompare(args.compareA, args.compareB, args.json);
    case "handoff":
      return runHandoff(args.selector);
    case "receipt":
    default:
      return runReceipt(args.selector, args.json);
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
