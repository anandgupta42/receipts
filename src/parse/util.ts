import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import type { TokenUsage } from "./types.js";

/** Expand a leading `~` to the user's home directory. */
export function expandHome(p: string): string {
  if (p === "~") {
    return os.homedir();
  }
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

export function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
}

/** Sum already-validated non-negative token counters without losing integer precision. */
export function safeTokenSum(values: readonly number[]): number | undefined {
  let total = 0;
  for (const value of values) {
    if (total > Number.MAX_SAFE_INTEGER - value) {
      return undefined;
    }
    total += value;
  }
  return total;
}

/**
 * Sum two optional split-tier fields. `undefined` means "this contributor
 * has no tier breakdown", not zero, so the sum only stays `undefined` when
 * *both* sides lack one — combining a turn with a known split and a turn
 * without one must not fabricate a false "0 tokens at this tier" for the
 * turn that never reported it.
 */
function addOptional(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
}

export function addUsage(a: TokenUsage, b: Partial<TokenUsage>): TokenUsage {
  return {
    input: a.input + (b.input ?? 0),
    output: a.output + (b.output ?? 0),
    cacheRead: a.cacheRead + (b.cacheRead ?? 0),
    cacheCreation: a.cacheCreation + (b.cacheCreation ?? 0),
    cacheCreation5m: addOptional(a.cacheCreation5m, b.cacheCreation5m),
    cacheCreation1h: addOptional(a.cacheCreation1h, b.cacheCreation1h),
    total: a.total + (b.total ?? 0),
  };
}

/** Recompute `total` from the component fields. Split tier fields are a breakdown of `cacheCreation`, not additional tokens, so they don't add to `total`. */
export function withTotal(u: TokenUsage): TokenUsage {
  return { ...u, total: u.input + u.output + u.cacheRead + u.cacheCreation };
}

/**
 * Scale every component of `usage` by `factor` (e.g. `1 / toolCallCount` to
 * split a turn's cost evenly across the tools it called). Split-tier fields
 * scale like `cacheCreation` itself — proportionally, staying `undefined`
 * when the source usage never reported a tier breakdown.
 */
export function scaleUsage(usage: TokenUsage, factor: number): TokenUsage {
  return {
    input: usage.input * factor,
    output: usage.output * factor,
    cacheRead: usage.cacheRead * factor,
    cacheCreation: usage.cacheCreation * factor,
    cacheCreation5m: usage.cacheCreation5m === undefined ? undefined : usage.cacheCreation5m * factor,
    cacheCreation1h: usage.cacheCreation1h === undefined ? undefined : usage.cacheCreation1h * factor,
    total: usage.total * factor,
  };
}

/** Parse a timestamp that may be ISO-8601, epoch ms, or epoch seconds. */
export function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === "number") {
    // seconds vs milliseconds heuristic
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) {
      return ms;
    }
    const num = Number(value);
    if (!Number.isNaN(num)) {
      return num < 1e12 ? Math.round(num * 1000) : Math.round(num);
    }
  }
  return undefined;
}

// Terminal-escape sanitation (v0.1.0 release-board QA finding): transcript
// content is untrusted — a title carrying raw ESC/CSI/OSC bytes would other-
// wise reach the operator’s terminal verbatim (OSC-0 retitle confirmed in the
// finding). Strip full ANSI/OSC sequences first, then every remaining C0/C1
// control, tab/CR/newline included (display strings never carry raw
// line breaks; a CR could redraw a receipt row). DEL included.
// CSI (ESC [ ... final), OSC (ESC ] ... BEL / ESC-backslash), and the nF/Fe
// escape forms (ESC + optional intermediates 0x20-0x2F + a final 0x30-0x7E,
// covering charset designators like ESC ( B). Ordered so CSI/OSC win first.
const ANSI_SEQUENCE_RE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\)?|[ -/]*[0-~])/g;
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F-\u009F]/g;

/** Strip ANSI/OSC escape sequences and control characters from untrusted transcript text. */
export function sanitizeText(text: string): string {
  return text.replace(ANSI_SEQUENCE_RE, "").replace(CONTROL_CHARS_RE, "");
}

export function truncate(text: string, max = 120): string {
  const clean = sanitizeText(text).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Read a JSONL file, yielding each parsed record. Malformed (non-empty,
 * unparseable) lines are skipped; the RETURNED count of skipped lines lets a
 * caller record `session.droppedRecords` so a torn transcript's under-report is
 * flagged, not silent (SPEC-0044 B3). Streams line-by-line so large transcripts
 * don't load fully into memory. Blank lines are not records and never counted.
 */
export async function readJsonl(
  filePath: string,
  onRecord: (record: unknown, lineNo: number) => void,
): Promise<number> {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  let lineNo = 0;
  let dropped = 0;
  try {
    for await (const line of rl) {
      lineNo++;
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        onRecord(JSON.parse(trimmed), lineNo);
      } catch {
        dropped++;
      }
    }
  } finally {
    rl.close();
    stream.close();
  }
  return dropped;
}

/** Recursively list files under `dir` matching `predicate`. Returns [] if dir is absent. */
export async function listFiles(
  dir: string,
  predicate: (name: string) => boolean,
  maxDepth = 6,
): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && predicate(entry.name)) {
        out.push(full);
      }
    }
  }
  await walk(dir, 0);
  return out;
}

/**
 * Map `items` through `fn` with at most `limit` in flight. Preserves input order.
 * Overlaps per-file I/O when building session-list summaries.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}
