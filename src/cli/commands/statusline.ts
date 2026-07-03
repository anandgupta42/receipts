// SPEC-0018: `statusline` — one-line summary for Claude Code's statusLine
// (SPEC-0007). priority 90, matches the `statusline` positional subcommand. The
// stdin/disk resolution seams are exported (and re-exported from
// `src/cli/index.js`) so the existing statusline integration tests keep their
// injectable listSessions/loadSession/stdin entry points.
import { listSessions, loadById, loadSession } from "../../index.js";
import type { Session, SessionSummary } from "../../parse/types.js";
import { buildReceiptModel } from "../../receipt/model.js";
import { renderStatusline } from "../../receipt/mini.js";
import type { CommandContext, CommandDef } from "../types.js";

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

/**
 * R3a: parse Claude Code's statusLine stdin payload (`{"transcript_path": "...", ...}`)
 * and load the referenced session directly — no session-list scan needed.
 * Returns `null` on any malformed/absent payload so the caller can fall back to
 * R3b disk mode; never throws.
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
 * R3/R4: statusline one-liner. stdin mode first, then disk fallback, then a
 * neutral no-session placeholder (never an error, always exit 0). `write` is the
 * output seam — the command passes `ctx.stdout` so output routes through the
 * context (R3); it defaults to `process.stdout` for the direct-call tests.
 */
export async function runStatusline(
  stdin: NodeJS.ReadStream = process.stdin,
  loadFromDiskFn: () => Promise<Session | null> = loadFromDisk,
  write: (s: string) => void = (s) => {
    process.stdout.write(s);
  },
): Promise<number> {
  const raw = await readStdin(stdin);
  const session = (await loadFromStdinPayload(raw)) ?? (await loadFromDiskFn());
  if (!session) {
    write("aireceipts: no sessions detected\n");
    return 0;
  }
  const model = await buildReceiptModel(session);
  write(`${renderStatusline(model)}\n`);
  return 0;
}

function run(ctx: CommandContext): Promise<number> {
  return runStatusline(ctx.stdin, loadFromDisk, (s) => ctx.stdout.write(s));
}

export const command: CommandDef = {
  name: "statusline",
  priority: 90,
  matches: (options) => options.positional[0] === "statusline",
  run,
  help: {
    order: 180,
    lines: ["  aireceipts statusline                 one-line summary for Claude Code's statusLine"],
  },
};
