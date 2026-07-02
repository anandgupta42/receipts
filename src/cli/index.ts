// R6 CLI dispatcher. Delegates session lookup/selection to the already-shipped
// `listSessions`/`selectSummary`/`loadSession` (parse layer, core-engine's) —
// no selector logic is reimplemented here.
import { writeFile } from "node:fs/promises";
import { anyDetected, listFullSessions, listSessions, loadById, loadSession, newestSession, rootsHint, selectSummary } from "../index.js";
import type { Session, SessionSummary } from "../parse/types.js";
import { evaluateBudget } from "../budget/index.js";
import { renderCompare, compareDeltaLine } from "../receipt/compare.js";
import { toCompareCsv } from "../receipt/csv.js";
import { getExporter } from "../receipt/exporters.js";
import { DEFAULT_HANDOFF_THRESHOLD, renderHandoff, standingRuleSuggestions } from "../receipt/handoff.js";
import { formatAbsoluteUtc, formatInt } from "../receipt/format.js";
import { summaryToJson, toCompareJsonModel, toJsonModel } from "../receipt/json.js";
import { buildReceiptModel } from "../receipt/model.js";
import { renderReceipt } from "../receipt/render.js";
import { renderReceiptSvg, renderCompareSvg } from "../receipt/svg.js";
import { rasterizeSvgToPng } from "../receipt/png.js";
import { renderWeek, weekToJson } from "../receipt/week.js";
import { buildWeekDigest, partitionWindows, windowBounds } from "../aggregate/week.js";
import { aggregateWaste, type WasteClassAggregate } from "../aggregate/waste.js";
import { renderMiniReceipt, renderStatusline } from "../receipt/mini.js";
import { installHook, uninstallHook } from "../hook/install.js";
import type { HookIo } from "../hook/install.js";
import { createInterface } from "node:readline";
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
import { runPr } from "../pr/index.js";

const HELP_TEXT = `aireceipts — local, deterministic cost receipts for AI coding-agent sessions

Usage:
  aireceipts [selector] [--json|--csv]  print a receipt (default: newest session)
  aireceipts --list [--json]            list sessions, newest first
  aireceipts compare <a> <b> [--json|--csv]  side-by-side (or stacked) comparison
  aireceipts --handoff [selector] [--handoff-threshold N]
                                        paste-ready block of fired waste lines;
                                         suggests CLAUDE.md rules for waste classes
                                         recurring in N+ recent sessions (default 3)
  aireceipts --quota                    current Claude Code rate-limit window usage
                                         (statusline stdin mode only; silent if unavailable)
  aireceipts [selector] --svg [-o f]    write a shareable SVG receipt (default receipt.svg)
  aireceipts [selector] --png [-o f]    write a rasterized PNG receipt (default receipt.png)
  aireceipts compare <a> <b> --svg      write a side-by-side SVG (default compare.svg)
  aireceipts week [--by-project] [--since <date>] [--json]
                                        trailing-7-day digest across sessions
  aireceipts pr [--post] [--session <id>]
                                        attach the building session's receipt to
                                         the current PR (dry-run prints the body;
                                         --post upserts it via gh)
  aireceipts --check-budget             exit 1 if ~/.aireceipts/budget.json's cap is
                                         exceeded (advisory; see docs)
  aireceipts benchmark [--dry-run]      opt-in cost-per-turn benchmark (v1: client
                                         contract only, sends disabled)
  aireceipts --mini [selector]          6-line mini-receipt (newest session)
  aireceipts install-hook               add a Claude Code SessionEnd auto-receipt hook
  aireceipts uninstall-hook             remove that hook
  aireceipts statusline                 one-line summary for Claude Code's statusLine
  aireceipts --help                     show this help

flags: --svg renders an SVG file; --png rasterizes it (receipt only, not compare);
       --theme light|dark picks the palette (default light); -o/--output names the file.
--csv[=session|tool]: export CSV (session summary rows, or one row per tool).
selector: a 1-based index into --list, a session id, or a title substring.`;

interface SvgOut {
  svg: boolean;
  png: boolean;
  theme: "light" | "dark";
  output?: string;
}

async function writeSvg(svg: string, path: string): Promise<void> {
  await writeFile(path, svg, "utf8");
  process.stdout.write(`wrote ${path} (${Buffer.byteLength(svg)} bytes)\n`);
}

async function writePng(png: Buffer, path: string): Promise<void> {
  await writeFile(path, png);
  process.stdout.write(`wrote ${path} (${png.length} bytes)\n`);
}

async function noSessionsMessage(): Promise<string> {
  if (!(await anyDetected())) {
    return `no agent session data detected. Looked in:\n${rootsHint()}`;
  }
  return "no sessions found";
}

async function resolveSelector(selector: string | undefined): Promise<{ summary: SessionSummary } | { error: string }> {
  if (selector === undefined || selector.trim() === "") {
    const summary = await newestSession();
    if (!summary) {
      return { error: await noSessionsMessage() };
    }
    return { summary };
  }
  const sessions = await listFullSessions();
  if (sessions.length === 0) {
    return { error: await noSessionsMessage() };
  }
  const summary = selectSummary(sessions, selector);
  if (!summary) {
    return { error: `no session matched "${selector}"` };
  }
  return { summary };
}

const CSV_MODE_HINT = 'use --csv=session or --csv=tool';

async function runReceipt(selector: string | undefined, json: boolean, svgOut: SvgOut, csvMode: string | undefined): Promise<number> {
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
  if (svgOut.png) {
    const svg = renderReceiptSvg(model, { theme: svgOut.theme });
    await writePng(rasterizeSvgToPng(svg), svgOut.output ?? "receipt.png");
    return 0;
  }
  if (csvMode !== undefined) {
    const exporter = getExporter(`csv-${csvMode}`);
    if (!exporter) {
      process.stderr.write(`unknown --csv mode "${csvMode}" (${CSV_MODE_HINT})
`);
      return 1;
    }
    // CSV is a data contract — budget advisory lines never ride along (SPEC-0009 x SPEC-0011).
    process.stdout.write(`${exporter.export(model)}\n`);
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
  const sessions = await listFullSessions();
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
  csvMode: string | undefined,
): Promise<number> {
  if (!selectorA || !selectorB) {
    process.stderr.write("compare requires two selectors: aireceipts compare <a> <b>\n");
    return 1;
  }
  // compare CSV is strictly two session rows + a delta (R3) — per-tool granularity has no two-row shape here.
  if (csvMode !== undefined && csvMode !== "session") {
    process.stderr.write(`compare supports --csv=session only (got "${csvMode}")\n`);
    return 1;
  }
  // SPEC-0012 R5: compare --png is deferred (doubles the blast radius of a new
  // native dependency) — checked before any session lookup, same as csvMode above.
  if (svgOut.png) {
    process.stderr.write("compare --png is not supported yet — use compare --svg\n");
    return 1;
  }
  const sessions = await listFullSessions();
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
  } else if (csvMode !== undefined) {
    process.stdout.write(`${toCompareCsv(modelA, modelB, compareDeltaLine(modelA, modelB))}\n`);
  } else if (json) {
    process.stdout.write(`${JSON.stringify(toCompareJsonModel(modelA, modelB), null, 2)}\n`);
  } else {
    process.stdout.write(`${renderCompare(modelA, modelB)}\n`);
  }
  return 0;
}

/**
 * SPEC-0013 R1: aggregate waste across the trailing-7-day window (SPEC-0008's
 * window definition, reused so there's one notion of "recent"). Feeds the
 * distinct-session recurrence check for standing-rule suggestions.
 */
async function recentWasteAggregates(now: number = Date.now()): Promise<WasteClassAggregate[]> {
  const bounds = windowBounds(now);
  const summaries = await listSessions();
  const { current } = partitionWindows(summaries, bounds);
  const loaded = await Promise.all(current.map((s) => loadSession(s)));
  return aggregateWaste(loaded.filter((s): s is Session => s !== null));
}

async function runHandoff(selector: string | undefined, thresholdArg: number | undefined): Promise<number> {
  const threshold = thresholdArg ?? DEFAULT_HANDOFF_THRESHOLD;
  if (thresholdArg !== undefined && (!Number.isInteger(threshold) || threshold < 1)) {
    process.stderr.write("invalid --handoff-threshold (expected a positive integer)\n");
    return 1;
  }
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
  const suggestions = standingRuleSuggestions(await recentWasteAggregates(), threshold);
  process.stdout.write(`${renderHandoff(model, suggestions)}\n`);
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
 * `--mini` (SPEC-0006 R4): render the newest session's 6-line receipt. Invoked
 * by the SessionEnd hook, so it is fail-safe (R6) — any error (no sessions, a
 * parse failure) is swallowed and the process still exits 0, never blocking or
 * failing Claude Code's own shutdown.
 */
async function runMini(selector: string | undefined): Promise<number> {
  try {
    const resolved = await resolveSelector(selector);
    if ("error" in resolved) {
      process.stderr.write(`${resolved.error}\n`);
      return 0;
    }
    const session = await loadSession(resolved.summary);
    if (!session) {
      return 0;
    }
    process.stdout.write(`${renderMiniReceipt(await buildReceiptModel(session))}\n`);
  } catch {
    // Fire-and-forget: a mini-receipt failure must never surface as a hook error.
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

/**
 * Read a single `[y/N]` answer from stdin; true only on an explicit yes (R1).
 * On EOF / no TTY (piped or non-interactive invocation) the `question` callback
 * never fires, so a `close` handler resolves the default `No` rather than
 * hanging the process — the prompt must never block or write without a yes.
 */
function stdinConfirm(promptText: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.question(promptText, (answer) => {
      answered = true;
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
    rl.on("close", () => {
      if (!answered) {
        resolve(false);
      }
    });
  });
}

function cliHookIo(): HookIo {
  return {
    confirm: stdinConfirm,
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
  };
}

/**
 * R3a: read the whole of `stream`. TTY streams (interactive terminal, no
 * pipe) are treated as "no payload" rather than blocking on a read that will
 * never end.
 */
export async function readStdin(stream: NodeJS.ReadStream): Promise<string> {
  if (stream.isTTY) {
    return "";
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * R3a: parse Claude Code's statusLine stdin payload (`{"transcript_path": "...", ...}`)
 * and load the referenced session directly — no session-list scan needed.
 * Returns `null` on any malformed/absent payload so the caller can fall back
 * to R3b disk mode; never throws.
 */
export async function loadFromStdinPayload(raw: string): Promise<Session | null> {
  if (!raw.trim()) {
    return null;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  const transcriptPath = (payload as { transcript_path?: unknown } | null)?.transcript_path;
  if (typeof transcriptPath !== "string" || !transcriptPath) {
    return null;
  }
  return loadById("claude-code", transcriptPath).catch(() => null);
}

/**
 * R3b: no usable stdin payload — fall back to the most-recently-ended session
 * on disk (already the fast, summary-only scan from `listSessions`).
 * `listSessionsFn`/`loadSessionFn` are injectable (default: the real
 * disk-scanning implementations) so tests can point this at a fixture corpus
 * instead of the real session roots — mirrors `runStatusline`'s injectable
 * `stdin` parameter below.
 */
export async function loadFromDisk(
  listSessionsFn: () => Promise<SessionSummary[]> = listSessions,
  loadSessionFn: (summary: SessionSummary) => Promise<Session | null> = loadSession,
): Promise<Session | null> {
  const sessions = await listSessionsFn();
  const summary = sessions[0];
  if (!summary) {
    return null;
  }
  return loadSessionFn(summary);
}

/** R3/R4: statusline one-liner. stdin mode first, then disk fallback, then a neutral no-session placeholder (never an error, always exit 0). */
export async function runStatusline(
  stdin: NodeJS.ReadStream = process.stdin,
  loadFromDiskFn: () => Promise<Session | null> = loadFromDisk,
): Promise<number> {
  const raw = await readStdin(stdin);
  const session = (await loadFromStdinPayload(raw)) ?? (await loadFromDiskFn());
  if (!session) {
    process.stdout.write("aireceipts: no sessions detected\n");
    return 0;
  }
  const model = await buildReceiptModel(session);
  process.stdout.write(`${renderStatusline(model)}\n`);
  return 0;
}

async function dispatch(args: ReturnType<typeof parseArgs>): Promise<number> {
  const svgOut: SvgOut = { svg: args.svg, png: args.png, theme: args.theme, output: args.output };
  switch (args.command) {
    case "mini":
      return runMini(args.selector);
    case "install-hook":
      return installHook(cliHookIo());
    case "uninstall-hook":
      return uninstallHook(cliHookIo());
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
      return runCompare(args.compareA, args.compareB, args.json, svgOut, args.csvMode);
    case "handoff":
      return runHandoff(args.selector, args.handoffThreshold);
    case "quota":
      return runQuota();
    case "week":
      return runWeek(args);
    case "check-budget":
      return runCheckBudget();
    case "benchmark":
      return runBenchmark(args.selector, args.dryRun);
    case "statusline":
      return runStatusline();
    case "pr":
      return runPr({ post: args.post === true, session: args.prSession });
    case "receipt":
    default:
      return runReceipt(args.selector, args.json, svgOut, args.csvMode);
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
