// SPEC-0018: `statusline` — one-line summary for Claude Code's statusLine
// (SPEC-0007). priority 90, matches the `statusline` positional subcommand. The
// stdin/disk resolution seams are exported (and re-exported from
// `src/cli/index.js`) so the existing statusline integration tests keep their
// injectable listSessions/loadSession/stdin entry points. SPEC-0062: the line
// renders through the segments engine — the default line IS the format
// `brand,model,cost,burn,tokens,context,waste,quota5h` (SPEC-0076 added the
// model segment), and `--format` selects any other segment list (unknown names
// fail fast, exit 1).
import * as os from "node:os";
import * as path from "node:path";
import { listSessions, listSessionsForCwd, loadById, loadSession } from "../../index.js";
import type { Session, SessionSummary } from "../../parse/types.js";
import { cwdMatchesForAttribution } from "../../parse/cwdScope.js";
import { buildReceiptModel } from "../../receipt/model.js";
import { attachSubagentRollup } from "../../receipt/subagents.js";
import { buildMiniSummary } from "../../receipt/mini.js";
import { DEFAULT_FORMAT, parseFormat, renderSegments, SEGMENT_NAMES } from "../statuslineSegments.js";
import { loadStatuslineFormatConfig } from "../statuslineConfig.js";
import type { CommandContext, CommandDef } from "../types.js";
import type { InputModeValue, ResultValue } from "../../telemetry/schemas.js";

export interface StatuslineTelemetryInfo {
  inputMode: InputModeValue;
  payloadValid: boolean;
  result: ResultValue;
  /** SPEC-0062 R5 — the invocation carried an explicit `--format` (boolean, never the format string). */
  customFormat: boolean;
  /** SPEC-0075 R6 — boolean only; the raw `--cwd` path must never enter a telemetry payload. */
  scoped: boolean;
  /** SPEC-0075 R6 — boolean only; config contents must never enter a telemetry payload. */
  configFile: boolean;
}

/**
 * R3a: read the whole of `stream`. TTY streams (interactive terminal, no pipe)
 * are treated as "no payload" rather than blocking on a read that never ends.
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

/** The parsed stdin payload, or `null` for absent/malformed input — never throws. */
export function parsePayload(raw: string): unknown {
  if (!raw.trim()) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * R3a: load the session referenced by Claude Code's statusLine stdin payload
 * (`{"transcript_path": "...", ...}`) directly — no session-list scan needed.
 * Returns `null` on any malformed/absent payload so the caller can fall back to
 * R3b disk mode; never throws.
 */
export async function loadFromStdinPayload(raw: string): Promise<Session | null> {
  const payload = parsePayload(raw);
  const transcriptPath = (payload as { transcript_path?: unknown } | null)?.transcript_path;
  if (typeof transcriptPath !== "string" || !transcriptPath) {
    return null;
  }
  return loadById("claude-code", transcriptPath).catch(() => null);
}

/**
 * R3b: no usable stdin payload — fall back to the most-recently-ended session on
 * disk. `listSessionsFn`/`loadSessionFn` are injectable (default: the real
 * disk-scanning implementations) so tests can point this at a fixture corpus.
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

/**
 * SPEC-0075 R1 — the cap on full-transcript loads while walking scoped
 * candidates newest-first. A collision-heavy Claude Code project dir could
 * otherwise trigger an unbounded sequence of full parses in a status bar that
 * polls; past the cap the line renders the neutral placeholder — bounded work
 * and an honest omission, never a wrong session and never a latency blowup.
 */
export const MAX_SCOPED_LOAD_ATTEMPTS = 8;

/**
 * SPEC-0075 R1 — load the newest cwd-scoped candidate. Claude Code needs
 * post-load cwd confirmation because its directory names are lossy; every
 * other adapter gets the same belt-and-suspenders check so an injected
 * `listSessionsFn` or future lazy/full divergence can never render a mismatched
 * session. A mismatch or unreadable candidate falls through to the next row,
 * and the walk stops at MAX_SCOPED_LOAD_ATTEMPTS.
 */
export async function loadFromCwd(
  requestedCwd: string,
  listSessionsFn: (cwd: string, homeDir: string) => Promise<SessionSummary[]> = listSessionsForCwd,
  loadSessionFn: (summary: SessionSummary) => Promise<Session | null> = loadSession,
  homeDir: string = os.homedir(),
): Promise<Session | null> {
  const sessions = await listSessionsFn(requestedCwd, homeDir);
  for (const summary of sessions.slice(0, MAX_SCOPED_LOAD_ATTEMPTS)) {
    const session = await loadSessionFn(summary);
    if (!session) {
      continue;
    }
    if (typeof session.cwd !== "string" || !cwdMatchesForAttribution(session.cwd, requestedCwd, homeDir)) {
      continue;
    }
    return session;
  }
  return null;
}

export interface RunStatuslineOptions {
  /** SPEC-0062 R3 — explicit `--format` segment spec; absent → `DEFAULT_FORMAT`. */
  format?: string;
  /** SPEC-0075 R1 — requested cwd for scoped disk fallback; stdin still wins. */
  cwd?: string;
  /** Injectable scoped loader seam for fixture-only statusline tests. */
  loadFromCwdFn?: (cwd: string) => Promise<Session | null>;
  /** Error sink for the fail-fast unknown-segment path; defaults to `process.stderr`. */
  writeError?: (s: string) => void;
  /** Clock + state-file seams for the `quotaEta` segment (tests). */
  nowMs?: number;
  quotaStatePath?: string;
  /** SPEC-0075 R2 — exact config-file path seam for tests. */
  formatConfigPath?: string;
}

/**
 * R3/R4 (SPEC-0007) + SPEC-0062: stdin mode first, then disk fallback, then a
 * neutral no-session placeholder (never an error, always exit 0 — except a
 * malformed `--format` or empty `--cwd`, which is a caller mistake and fails
 * fast with exit 1, one line on stderr, and nothing on stdout). `write` is the
 * output seam — the command passes `ctx.stdout` so output routes through the
 * context; it defaults to `process.stdout` for the direct-call tests.
 */
export async function runStatusline(
  stdin: NodeJS.ReadStream = process.stdin,
  loadFromDiskFn: () => Promise<Session | null> = loadFromDisk,
  write: (s: string) => void = (s) => {
    process.stdout.write(s);
  },
  record?: (info: StatuslineTelemetryInfo) => void | Promise<void>,
  opts: RunStatuslineOptions = {},
): Promise<number> {
  const writeError =
    opts.writeError ??
    ((s: string) => {
      process.stderr.write(s);
    });
  const customFormat = opts.format !== undefined;
  let configFile = false;
  let parsed = parseFormat(opts.format ?? DEFAULT_FORMAT);
  if (customFormat && "unknown" in parsed) {
    writeError(`unknown statusline segment "${parsed.unknown}" (valid: ${SEGMENT_NAMES.join(", ")})\n`);
    return 1;
  }
  if (opts.cwd !== undefined && !opts.cwd.trim()) {
    writeError("--cwd requires a non-empty path\n");
    return 1;
  }
  // Resolve only genuinely relative input (`--cwd .`). A path that is already
  // absolute in EITHER platform's spelling passes through untouched — on
  // Windows, `path.resolve("/home/x")` would prepend the current drive and a
  // POSIX-recorded session (or a fixture) would never match again.
  const requestedCwd =
    opts.cwd === undefined
      ? undefined
      : path.posix.isAbsolute(opts.cwd) || path.win32.isAbsolute(opts.cwd)
        ? opts.cwd
        : path.resolve(opts.cwd);
  if (!customFormat) {
    const loaded = await loadStatuslineFormatConfig(opts.formatConfigPath);
    if (loaded.status === "ok") {
      parsed = { segments: loaded.config.items };
      configFile = true;
    } else if (loaded.status === "invalid") {
      writeError(`statusline.json ignored: ${loaded.reason}\n`);
    }
  }
  // `DEFAULT_FORMAT` is a source-controlled constant; only user input can
  // produce the unknown branch, which returned above.
  if ("unknown" in parsed) {
    return 1;
  }
  const scoped = requestedCwd !== undefined;
  const raw = await readStdin(stdin);
  const payload = parsePayload(raw);
  let inputMode: InputModeValue = raw.trim() ? "stdin_payload" : "none";
  let payloadValid = false;
  let session = await loadFromStdinPayload(raw);
  if (session) {
    payloadValid = true;
  } else {
    const diskSession =
      requestedCwd !== undefined ? await (opts.loadFromCwdFn ?? loadFromCwd)(requestedCwd) : await loadFromDiskFn();
    if (diskSession) {
      inputMode = "disk_fallback";
      session = diskSession;
    }
  }
  if (!session) {
    write("aireceipts: no sessions detected\n");
    await record?.({ inputMode, payloadValid, result: "no_data", customFormat, scoped, configFile });
    return 0;
  }
  // SPEC-0061 R3 — the one-liner covers parent + subagents (no children → zero extra transcript reads).
  const model = await attachSubagentRollup(await buildReceiptModel(session), session.filePath);
  const line = renderSegments(parsed.segments, {
    summary: buildMiniSummary(model),
    inputMode: payloadValid ? "stdin_payload" : "disk_fallback",
    payload,
    nowMs: opts.nowMs ?? Date.now(),
    ...(opts.quotaStatePath !== undefined ? { quotaStatePath: opts.quotaStatePath } : {}),
  });
  write(`${line}\n`);
  await record?.({ inputMode, payloadValid, result: "success", customFormat, scoped, configFile });
  return 0;
}

function run(ctx: CommandContext): Promise<number> {
  return runStatusline(
    ctx.stdin,
    loadFromDisk,
    (s) => ctx.stdout.write(s),
    (info) => ctx.telemetry.recordIntegrationSurfaceRendered({ integration: "statusline", ...info }),
    { format: ctx.options.format, cwd: ctx.options.cwd, writeError: (s) => ctx.stderr.write(s) },
  );
}

export const command: CommandDef = {
  name: "statusline",
  priority: 90,
  matches: (options) => options.positional[0] === "statusline",
  // SPEC-0075 R6 — `--cwd` is a polling integration: keep local counters and
  // event recording, but do not turn a 15s prompt/tmux poll into a network send.
  shouldFlushTelemetry: (options) => options.cwd === undefined,
  run,
  help: {
    order: 180,
    lines: ["  aireceipts statusline [--format <s>] [--cwd <path>]  the meter — model + running cost for Claude Code's statusLine (any bar via --cwd)"],
  },
};
