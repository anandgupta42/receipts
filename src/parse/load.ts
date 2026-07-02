import { adapterFor, adapters, detectedAdapters } from "./registry.js";
import type { AgentSource, Session, SessionSummary } from "./types.js";

/** All sessions across every adapter, most-recent-first. Per-adapter failures are isolated (never abort the whole list). */
export async function listSessions(agent?: AgentSource): Promise<SessionSummary[]> {
  const pool = agent ? adapters().filter((a) => a.id === agent) : adapters();
  const lists = await Promise.all(pool.map((a) => a.listSessions().catch(() => [] as SessionSummary[])));
  return lists.flat().sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
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
