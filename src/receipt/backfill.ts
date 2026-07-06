// SPEC-0056 R2/R8: the backfill summary surfaces — a compact text block and a
// versioned, fixed-key-order JSON object (validated by `backfillJsonSchema` in
// `exportSchema.ts`, doc-parity-gated like every other export surface). Pure
// formatting over a `BackfillReport` — no discovery, loading, or writing here.
import { center, dottedLine, formatInt } from "./format.js";
import { SCHEMA_VERSION } from "./schemaVersion.js";

const WIDTH = 50;

/** One matched session's outcome, adapter-agnostic and already resolved (loaded or failed). */
export interface BackfillReportEntry {
  source: string;
  sessionId: string;
  title: string | null;
  startedAtMs: number | null;
  /** The file name written under `--out`, or `null` (no `--out`, or the load failed). */
  fileName: string | null;
  loadFailed: boolean;
}

export interface BackfillReport {
  /** Every summary discovery returned, including degraded ones (R7). */
  discoveredCount: number;
  /** After `--since`/`--limit` (R6). */
  matchedCount: number;
  /**
   * R7 honesty, mode-dependent: with `--out` (loads attempted) this is degraded
   * summaries plus `loadSession` nulls; without `--out` it is only what discovery
   * already knows is unreadable — a dry run never parses transcripts, so it
   * reports (and labels) a known-unreadable lower bound rather than claiming a
   * measurement it never made.
   */
  loadFailureCount: number;
  /** Files written this run; 0 without `--out` (R2). */
  writtenCount: number;
  wroteFiles: boolean;
  /** `--out` was passed (render-only; distinguishes a dry run from a zero-match `--out` run). */
  outRequested: boolean;
  entries: BackfillReportEntry[];
}

/** R2: the deterministic text summary. A dry run says how to actually write files. */
export function renderBackfillSummary(report: BackfillReport): string {
  const lines: string[] = [];
  lines.push(center("BACKFILL", WIDTH));
  lines.push("");
  lines.push(dottedLine("Sessions discovered", formatInt(report.discoveredCount), WIDTH));
  lines.push(dottedLine("Matched (--since/--limit)", formatInt(report.matchedCount), WIDTH));
  // I3: never print a claim that wasn't measured — loads are attempted only when writing.
  lines.push(dottedLine(report.wroteFiles ? "Load failures" : "Known unreadable", formatInt(report.loadFailureCount), WIDTH));
  lines.push(dottedLine("Receipts written", formatInt(report.writtenCount), WIDTH));
  if (report.outRequested && report.matchedCount === 0) {
    lines.push("");
    lines.push("no sessions matched the filters; nothing written.");
  } else if (!report.outRequested) {
    lines.push("");
    lines.push("dry run — pass --out <dir> to write one receipt");
    lines.push("file per session plus an index.txt manifest.");
  }
  return lines.join("\n");
}

/** R8: the versioned JSON summary — fixed key order, `schemaVersion` first, hand-built (I5). */
export function backfillToJson(report: BackfillReport) {
  return {
    schemaVersion: SCHEMA_VERSION,
    discoveredCount: report.discoveredCount,
    matchedCount: report.matchedCount,
    loadFailureCount: report.loadFailureCount,
    writtenCount: report.writtenCount,
    wroteFiles: report.wroteFiles,
    sessions: report.entries.map((entry) => ({
      source: entry.source,
      sessionId: entry.sessionId,
      title: entry.title,
      startedAtMs: entry.startedAtMs,
      fileName: entry.fileName,
      loadFailed: entry.loadFailed,
    })),
  };
}
