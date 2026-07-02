import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { AGENT_SOURCES, type AgentSource, type Session, type SessionSummary, type TokenUsage } from "./types.js";
import type { DiscoveryStat } from "./discovery.js";
import { mapWithConcurrency } from "./util.js";

const CACHE_VERSION = 1;
const SOURCES = new Set<AgentSource>(AGENT_SOURCES);

interface CacheEntry {
  mtimeMs: number;
  size: number;
  summary: SessionSummary;
}

interface CacheFile {
  version: number;
  entries: Record<string, CacheEntry>;
}

export function summaryCachePath(homeOverride?: string): string {
  return join(homeOverride ?? process.env.AIRECEIPTS_HOME ?? homedir(), ".aireceipts", "cache.json");
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalFiniteNumber(value: unknown): boolean {
  return value === undefined || finiteNumber(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function tokenUsage(value: unknown): value is TokenUsage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const usage = value as Record<string, unknown>;
  return (
    finiteNumber(usage.input) &&
    finiteNumber(usage.output) &&
    finiteNumber(usage.cacheRead) &&
    finiteNumber(usage.cacheCreation) &&
    finiteNumber(usage.total) &&
    (usage.cacheCreation5m === undefined || finiteNumber(usage.cacheCreation5m)) &&
    (usage.cacheCreation1h === undefined || finiteNumber(usage.cacheCreation1h))
  );
}

function sessionSummary(value: unknown): value is SessionSummary {
  if (!value || typeof value !== "object") {
    return false;
  }
  const summary = value as Record<string, unknown>;
  const totals = summary.totals as Record<string, unknown> | undefined;
  return (
    typeof summary.id === "string" &&
    typeof summary.source === "string" &&
    SOURCES.has(summary.source as AgentSource) &&
    optionalString(summary.title) &&
    optionalString(summary.model) &&
    optionalFiniteNumber(summary.startedAt) &&
    optionalFiniteNumber(summary.endedAt) &&
    typeof summary.filePath === "string" &&
    optionalBoolean(summary.unpriceable) &&
    optionalString(summary.cwd) &&
    optionalString(summary.gitBranch) &&
    optionalBoolean(summary.isSidechain) &&
    optionalString(summary.parentSessionId) &&
    optionalString(summary.agentId) &&
    optionalString(summary.parentFilePath) &&
    typeof totals === "object" &&
    totals !== null &&
    tokenUsage(totals.tokens) &&
    finiteNumber(totals.turnCount) &&
    finiteNumber(totals.toolCallCount) &&
    (totals.durationMs === undefined || finiteNumber(totals.durationMs))
  );
}

function cacheEntry(value: unknown): value is CacheEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return finiteNumber(entry.mtimeMs) && finiteNumber(entry.size) && sessionSummary(entry.summary);
}

function parseCache(raw: string): Record<string, CacheEntry> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    return {};
  }
  const file = parsed as Partial<CacheFile>;
  if (file.version !== CACHE_VERSION || !file.entries || typeof file.entries !== "object") {
    return {};
  }
  const entries: Record<string, CacheEntry> = {};
  for (const [key, entry] of Object.entries(file.entries)) {
    if (cacheEntry(entry)) {
      entries[key] = entry;
    }
  }
  return entries;
}

function stripTurns(session: Session): SessionSummary {
  const summary: Partial<Session> = { ...session };
  // Both are full-Session-only concepts — the cache stores SessionSummary rows,
  // and SPEC-0017 compactions (like turns) are recomputed on a full load.
  delete summary.turns;
  delete summary.compactions;
  return summary as SessionSummary;
}

export class SummaryCache {
  private dirty = false;

  private constructor(
    private readonly path: string,
    private readonly entries: Record<string, CacheEntry>,
  ) {}

  static async load(path: string = summaryCachePath()): Promise<SummaryCache> {
    try {
      return new SummaryCache(path, parseCache(await readFile(path, "utf8")));
    } catch {
      return new SummaryCache(path, {});
    }
  }

  get(filePath: string, stat: DiscoveryStat): SessionSummary | undefined {
    const entry = this.entries[filePath];
    if (!entry || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size) {
      return undefined;
    }
    return entry.summary;
  }

  set(filePath: string, stat: DiscoveryStat, summary: SessionSummary): void {
    this.entries[filePath] = { mtimeMs: stat.mtimeMs, size: stat.size, summary };
    this.dirty = true;
  }

  async save(): Promise<void> {
    if (!this.dirty) {
      return;
    }
    const ordered = Object.fromEntries(Object.entries(this.entries).sort(([a], [b]) => a.localeCompare(b)));
    const raw = `${JSON.stringify({ version: CACHE_VERSION, entries: ordered }, null, 2)}\n`;
    try {
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.${process.pid}.tmp`;
      await writeFile(tmp, raw, "utf8");
      await rename(tmp, this.path);
    } catch {
      // Cache failures must never affect product answers; the next run will rebuild.
    }
  }
}

export interface CompleteSummaryOptions {
  cache?: SummaryCache;
  cachePath?: string;
  stat: (filePath: string) => Promise<DiscoveryStat>;
  load: (summary: SessionSummary) => Promise<Session | null>;
}

export async function completeSummariesWithCache(
  summaries: SessionSummary[],
  opts: CompleteSummaryOptions,
): Promise<SessionSummary[]> {
  const cache = opts.cache ?? (await SummaryCache.load(opts.cachePath));
  const results = await mapWithConcurrency(summaries, 16, async (summary) => {
    let stat: DiscoveryStat;
    try {
      stat = await opts.stat(summary.filePath);
      if (stat.size === 0) {
        return null;
      }
      const cached = cache.get(summary.filePath, stat);
      if (cached) {
        return cached;
      }
      const full = await opts.load(summary);
      if (!full) {
        return null;
      }
      const fullSummary = stripTurns(full);
      cache.set(summary.filePath, stat, fullSummary);
      return fullSummary;
    } catch {
      return null;
    }
  });
  if (!opts.cache) {
    await cache.save();
  }
  return results.filter((summary): summary is SessionSummary => summary !== null);
}
