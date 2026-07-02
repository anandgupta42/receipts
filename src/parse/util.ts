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
  return { input: 0, output: 0, cacheRead: 0, total: 0 };
}

export function addUsage(a: TokenUsage, b: Partial<TokenUsage>): TokenUsage {
  return {
    input: a.input + (b.input ?? 0),
    output: a.output + (b.output ?? 0),
    cacheRead: a.cacheRead + (b.cacheRead ?? 0),
    total: a.total + (b.total ?? 0),
  };
}

/** Recompute `total` from the component fields. */
export function withTotal(u: TokenUsage): TokenUsage {
  return { ...u, total: u.input + u.output + u.cacheRead };
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

export function truncate(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Read a JSONL file, yielding each parsed record. Malformed lines are skipped.
 * Streams line-by-line so large transcripts don't load fully into memory.
 */
export async function readJsonl(
  filePath: string,
  onRecord: (record: unknown, lineNo: number) => void,
): Promise<void> {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  let lineNo = 0;
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
        // skip malformed line
      }
    }
  } finally {
    rl.close();
    stream.close();
  }
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
