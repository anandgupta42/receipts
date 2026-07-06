// SPEC-0018: `statusline` — one-line summary for Claude Code's statusLine
// (SPEC-0007). priority 90, matches the `statusline` positional subcommand. The
// stdin/disk resolution seams are exported (and re-exported from
// `src/cli/index.js`) so the existing statusline integration tests keep their
// injectable listSessions/loadSession/stdin entry points. SPEC-0062: the line
// renders through the segments engine — the default line IS the format
// `brand,cost,tokens,waste,quota5h`, and `--format` selects any other segment
// list (unknown names fail fast, exit 1).
import { listSessions, loadById, loadSession } from "../../index.js";
import type { Session, SessionSummary } from "../../parse/types.js";
import { buildReceiptModel } from "../../receipt/model.js";
import { attachSubagentRollup } from "../../receipt/subagents.js";
import { buildMiniSummary } from "../../receipt/mini.js";
import { DEFAULT_FORMAT, parseFormat, renderSegments, SEGMENT_NAMES } from "../statuslineSegments.js";
import type { CommandContext, CommandDef } from "../types.js";
import type { InputModeValue, ResultValue } from "../../telemetry/schemas.js";

export interface StatuslineTelemetryInfo {
  inputMode: InputModeValue;
  payloadValid: boolean;
  result: ResultValue;
  /** SPEC-0062 R5 — the invocation carried an explicit `--format` (boolean, never the format string). */
  customFormat: boolean;
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

export interface RunStatuslineOptions {
  /** SPEC-0062 R3 — explicit `--format` segment spec; absent → `DEFAULT_FORMAT`. */
  format?: string;
  /** Error sink for the fail-fast unknown-segment path; defaults to `process.stderr`. */
  writeError?: (s: string) => void;
  /** Clock + state-file seams for the `quotaEta` segment (tests). */
  nowMs?: number;
  quotaStatePath?: string;
}

/**
 * R3/R4 (SPEC-0007) + SPEC-0062: stdin mode first, then disk fallback, then a
 * neutral no-session placeholder (never an error, always exit 0 — except a
 * malformed `--format`, which is a caller mistake and fails fast with exit 1,
 * segment list on stderr, nothing on stdout). `write` is the output seam — the
 * command passes `ctx.stdout` so output routes through the context; it defaults
 * to `process.stdout` for the direct-call tests.
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
  const customFormat = opts.format !== undefined;
  const parsed = parseFormat(opts.format ?? DEFAULT_FORMAT);
  if ("unknown" in parsed) {
    const writeError =
      opts.writeError ??
      ((s: string) => {
        process.stderr.write(s);
      });
    writeError(`unknown statusline segment "${parsed.unknown}" (valid: ${SEGMENT_NAMES.join(", ")})\n`);
    return 1;
  }
  const raw = await readStdin(stdin);
  const payload = parsePayload(raw);
  let inputMode: InputModeValue = raw.trim() ? "stdin_payload" : "none";
  let payloadValid = false;
  let session = await loadFromStdinPayload(raw);
  if (session) {
    payloadValid = true;
  } else {
    const diskSession = await loadFromDiskFn();
    if (diskSession) {
      inputMode = "disk_fallback";
      session = diskSession;
    }
  }
  if (!session) {
    write("aireceipts: no sessions detected\n");
    await record?.({ inputMode, payloadValid, result: "no_data", customFormat });
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
  await record?.({ inputMode, payloadValid, result: "success", customFormat });
  return 0;
}

function run(ctx: CommandContext): Promise<number> {
  return runStatusline(
    ctx.stdin,
    loadFromDisk,
    (s) => ctx.stdout.write(s),
    (info) => ctx.telemetry.recordIntegrationSurfaceRendered({ integration: "statusline", ...info }),
    { format: ctx.options.format, writeError: (s) => ctx.stderr.write(s) },
  );
}

export const command: CommandDef = {
  name: "statusline",
  priority: 90,
  matches: (options) => options.positional[0] === "statusline",
  run,
  help: {
    order: 180,
    lines: ["  aireceipts statusline [--format <s>]  one-line summary for Claude Code's statusLine"],
  },
};
