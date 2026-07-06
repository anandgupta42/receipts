// SPEC-0056: `backfill` planning — the pure half of the bulk retroactive sweep.
// Everything here is a deterministic function of the discovered summaries and the
// flags (I1): filtering (`--since`/`--limit`), filesystem-safe file naming, and the
// manifest bytes. Disk I/O (discovery, per-session load, writes) stays in the
// command (`src/cli/commands/backfill.ts`).
import type { SessionSummary } from "../parse/types.js";

/** R3/R4: the fixed first line of `index.txt` — proof a directory belongs to a prior backfill run. */
export const MANIFEST_MARKER = "# aireceipts backfill manifest v1";

/** Max slug length inside a backfill file name (R3). */
const SLUG_MAX = 40;

/**
 * R3: a filesystem-safe derivative of a session id. `SessionSummary.id` can be an
 * absolute file path for file-based adapters, so the raw id never lands in a path
 * component: basename only, every character outside `[A-Za-z0-9._-]` replaced with
 * `-`, truncated to 40 chars. Uniqueness comes from the `seq` prefix, not the slug.
 */
export function slugForId(id: string): string {
  const base = id.split(/[/\\]/).filter((part) => part.length > 0).pop() ?? "";
  const safe = base.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, SLUG_MAX);
  return safe.length > 0 ? safe : "session";
}

/** R3: `<seq>-<source>-<slug>.txt`, `seq` zero-padded to the width of the total matched count. */
export function backfillFileName(seq: number, width: number, summary: SessionSummary): string {
  return `${String(seq).padStart(width, "0")}-${summary.source}-${slugForId(summary.id)}.txt`;
}

export interface BackfillFilters {
  /** R6: drop sessions that ended before this instant (epoch ms). */
  sinceMs?: number;
  /** R6: keep only the N most recent sessions after the `since` filter. */
  limit?: number;
}

/**
 * R6: apply `--since`/`--limit` to an already newest-first summary list.
 * The `since` filter uses `endedAt ?? startedAt`; a session with neither timestamp
 * cannot be proven older than the cutoff, so it is kept (honest inclusion beats a
 * silent time-based drop, SPEC-0045's spirit).
 */
export function filterSummaries(summaries: readonly SessionSummary[], filters: BackfillFilters): SessionSummary[] {
  let matched = summaries.filter((s) => {
    if (filters.sinceMs === undefined) {
      return true;
    }
    const when = s.endedAt ?? s.startedAt;
    return when === undefined || when >= filters.sinceMs;
  });
  if (filters.limit !== undefined) {
    matched = matched.slice(0, filters.limit);
  }
  return matched;
}

/** One matched session in the plan: its summary plus the file name a `--out` run writes. */
export interface BackfillPlanEntry {
  summary: SessionSummary;
  fileName: string;
  /** R7: `degraded: "unreadable"` summaries are load failures up front — never rendered, never dropped. */
  loadFailed: boolean;
}

export interface BackfillPlan {
  /** Every summary discovery returned, including degraded ones (R7). */
  discoveredCount: number;
  /** After `--since`/`--limit`, newest-first (R6). */
  entries: BackfillPlanEntry[];
}

/** Build the deterministic sweep plan from newest-first summaries (discovery order = `--list` order, R3). */
export function planBackfill(summaries: readonly SessionSummary[], filters: BackfillFilters): BackfillPlan {
  const matched = filterSummaries(summaries, filters);
  const width = String(matched.length).length;
  return {
    discoveredCount: summaries.length,
    entries: matched.map((summary, i) => ({
      summary,
      fileName: backfillFileName(i + 1, width, summary),
      loadFailed: summary.degraded !== undefined,
    })),
  };
}

/**
 * R3: the `index.txt` bytes — the marker line, then one written file name per line,
 * in plan order. Built only from session-derived facts (no wall-clock timestamp),
 * so an unchanged session set reproduces identical bytes (R5/I1).
 */
export function buildManifest(writtenFileNames: readonly string[]): string {
  return [MANIFEST_MARKER, ...writtenFileNames].join("\n") + "\n";
}
