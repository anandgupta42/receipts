import { adapterFor, adapters, detectedAdapters } from "./registry.js";
import type { AgentSource, Session, SessionSummary } from "./types.js";
import { SummaryCache, completeSummariesWithCache } from "./summaryCache.js";
import * as fs from "node:fs";

function sortMostRecentFirst(sessions: SessionSummary[]): SessionSummary[] {
  return sessions.sort((a, b) => (b.endedAt ?? b.startedAt ?? 0) - (a.endedAt ?? a.startedAt ?? 0));
}

/** Lazy sessions across every adapter, most-recent-first. Per-adapter failures are isolated (never abort the whole list). */
export async function listSessions(agent?: AgentSource): Promise<SessionSummary[]> {
  const pool = agent ? adapters().filter((a) => a.id === agent) : adapters();
  const lists = await Promise.all(pool.map((a) => a.listSessions().catch(() => [] as SessionSummary[])));
  return sortMostRecentFirst(lists.flat());
}

/**
 * Full summaries across every adapter, most-recent-first, with an incremental
 * file-summary cache for JSONL transcripts.
 *
 * SPEC-0045 R3 — a `degraded: "unreadable"` summary (retained by R1 so the PR layer
 * can flag an unreadable session) has no reliable totals, so it is EXCLUDED by
 * default: every non-PR consumer (`week`, `compare`, token budget, `--list`)
 * calls this without opting in and never sees a degraded summary's zero total.
 * Only the PR flow passes `includeDegraded: true`.
 */
export async function listFullSessions(agent?: AgentSource, opts?: { includeDegraded?: boolean }): Promise<SessionSummary[]> {
  const pool = agent ? adapters().filter((a) => a.id === agent) : adapters();
  const cache = await SummaryCache.load();
  const lists = await Promise.all(
    pool.map(async (adapter) => {
      try {
        if (adapter.id === "cursor" || adapter.id === "opencode") {
          return adapter.listSessions({ full: true });
        }
        const lazy = await adapter.listSessions();
        return completeSummariesWithCache(lazy, {
          cache,
          stat: (filePath) => fs.promises.stat(filePath),
          load: (summary) => loadById(summary.source, summary.id),
        });
      } catch {
        return [] as SessionSummary[];
      }
    }),
  );
  await cache.save();
  const all = lists.flat();
  const filtered = opts?.includeDegraded ? all : all.filter((s) => s.degraded === undefined);
  return sortMostRecentFirst(filtered);
}

/** The mtime-newest lazy summary, used before full-parsing exactly one default receipt session. */
export async function newestSession(agent?: AgentSource): Promise<SessionSummary | null> {
  return (await listSessions(agent))[0] ?? null;
}

/** Load one full session by its adapter source + id. */
export async function loadById(source: AgentSource, id: string): Promise<Session | null> {
  const adapter = adapterFor(source);
  if (!adapter) {
    return null;
  }
  return adapter.loadSession(id);
}

/** Load the full `Session` behind a `SessionSummary`. */
export async function loadSession(summary: SessionSummary): Promise<Session | null> {
  return loadById(summary.source, summary.id);
}

/** True if at least one adapter's transcript root is present on this machine. */
export async function anyDetected(): Promise<boolean> {
  return (await detectedAdapters()).length > 0;
}

/** A human-readable list of the roots we looked in, for "nothing found" error messages. */
export function rootsHint(): string {
  return adapters()
    .map((a) => a.roots()[0])
    .filter((r): r is string => typeof r === "string")
    .join(", ");
}

/**
 * Resolve a `--session` selector against a list of sessions (most-recent-first):
 * empty → most recent; a bare integer → 1-based index into the list; otherwise
 * matched against id/filePath, then a case-insensitive substring of the title.
 */
export function selectSummary(sessions: SessionSummary[], selector?: string): SessionSummary | null {
  if (sessions.length === 0) {
    return null;
  }
  const sel = (selector ?? "").trim();
  if (!sel) {
    return sessions[0];
  }
  if (/^\d+$/.test(sel)) {
    const idx = Number(sel) - 1;
    return sessions[idx] ?? null;
  }
  const byId = sessions.find((s) => s.id === sel || s.filePath === sel);
  if (byId) {
    return byId;
  }
  const lc = sel.toLowerCase();
  return sessions.find((s) => (s.title ?? "").toLowerCase().includes(lc)) ?? null;
}
