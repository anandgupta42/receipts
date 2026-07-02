import * as fs from "node:fs";
import type { AgentSource, SessionSummary } from "./types.js";
import { emptyUsage, parseTimestamp, truncate } from "./util.js";

export interface DiscoveryStat {
  size: number;
  mtimeMs: number;
}

export interface DiscoveryFs {
  stat(filePath: string): Promise<DiscoveryStat>;
  readFirstLine(filePath: string): Promise<string | null>;
}

const FIRST_LINE_CHUNK = 4096;
const FIRST_LINE_MAX_BYTES = 64 * 1024;

export async function readFirstLine(filePath: string): Promise<string | null> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const chunks: Buffer[] = [];
    let offset = 0;
    while (offset < FIRST_LINE_MAX_BYTES) {
      const buffer = Buffer.alloc(Math.min(FIRST_LINE_CHUNK, FIRST_LINE_MAX_BYTES - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (bytesRead === 0) {
        break;
      }
      const newline = buffer.indexOf(10, 0);
      const take = newline >= 0 && newline < bytesRead ? newline : bytesRead;
      chunks.push(buffer.subarray(0, take));
      if (newline >= 0 && newline < bytesRead) {
        break;
      }
      offset += bytesRead;
    }
    if (chunks.length === 0) {
      return null;
    }
    return Buffer.concat(chunks).toString("utf8").replace(/\r$/, "");
  } finally {
    await handle.close();
  }
}

export const nodeDiscoveryFs: DiscoveryFs = {
  stat: (filePath) => fs.promises.stat(filePath),
  readFirstLine,
};

function parseFirstRecord(line: string | null): Record<string, unknown> | undefined {
  if (!line?.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function unwrap(top: Record<string, unknown>): Record<string, unknown> {
  const candidates = ["payload", "item", "response"];
  for (const key of candidates) {
    const value = top[key];
    if (value && typeof value === "object") {
      return value as Record<string, unknown>;
    }
  }
  return top;
}

function extractText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const parts = content
    .map((part) => {
      if (part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
      return typeof part === "string" ? part : undefined;
    })
    .filter((part): part is string => typeof part === "string");
  return parts.length > 0 ? parts.join("") : undefined;
}

function emptyTotals() {
  return { tokens: emptyUsage(), turnCount: 0, toolCallCount: 0 };
}

interface LazySummaryInput {
  filePath: string;
  source: AgentSource;
  stat: DiscoveryStat;
  firstLine: string | null;
}

export function lazyClaudeCodeSummary(input: LazySummaryInput): SessionSummary {
  const first = parseFirstRecord(input.firstLine);
  const message = first?.message && typeof first.message === "object" ? (first.message as Record<string, unknown>) : undefined;
  const text = extractText(message?.content);
  const startedAt = parseTimestamp(first?.timestamp);
  return {
    id: input.filePath,
    source: "claude-code",
    title: text ? truncate(text) : undefined,
    startedAt,
    endedAt: input.stat.mtimeMs,
    totals: emptyTotals(),
    filePath: input.filePath,
    cwd: typeof first?.cwd === "string" && first.cwd ? first.cwd : undefined,
    gitBranch: typeof first?.gitBranch === "string" && first.gitBranch ? first.gitBranch : undefined,
    isSidechain: first?.isSidechain === true ? true : undefined,
  };
}

export function lazyCodexSummary(input: LazySummaryInput): SessionSummary {
  const top = parseFirstRecord(input.firstLine);
  const item = top ? unwrap(top) : undefined;
  const startedAt = parseTimestamp(item?.timestamp ?? top?.timestamp ?? top?.created_at ?? top?.time);
  return {
    id: input.filePath,
    source: "codex",
    title: undefined,
    startedAt,
    endedAt: input.stat.mtimeMs,
    totals: emptyTotals(),
    filePath: input.filePath,
    cwd: typeof item?.cwd === "string" && item.cwd ? item.cwd : undefined,
  };
}
