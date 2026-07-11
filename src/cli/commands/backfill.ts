// SPEC-0056: `backfill` — bulk retroactive receipts for sessions that predate the
// install. priority 55 (between --list at 50 and pr at 60), matches the `backfill`
// positional subcommand. Without `--out` it prints a deterministic summary and
// writes nothing (R2); with `--out` it writes one renderer-byte receipt per session
// plus a marker-bearing `index.txt` manifest (R3), refusing to clobber a directory
// it cannot prove is a prior backfill's (R4). Counting is honest per SPEC-0045:
// degraded summaries and failed loads are counted, never silently dropped (R7).
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { listFullSessions, loadSession } from "../../parse/load.js";
import type { Session, SessionSummary } from "../../parse/types.js";
import { MANIFEST_MARKER, buildManifest, planBackfill } from "../../aggregate/backfill.js";
import { buildFullSessionReceiptModel } from "../../receipt/subagents.js";
import { renderReceipt } from "../../receipt/render.js";
import { backfillToJson, renderBackfillSummary } from "../../receipt/backfill.js";
import type { BackfillReport, BackfillReportEntry } from "../../receipt/backfill.js";
import { noSessionsMessage } from "../common/session.js";
import type { CommandContext, CommandDef } from "../types.js";

/** Injectable seams so tests exercise the full command without real agent dirs. */
export interface BackfillDeps {
  listSummaries: () => Promise<SessionSummary[]>;
  load: (summary: SessionSummary) => Promise<Session | null>;
  /** The `--list`-family empty-state message (the real one re-scans agent roots). */
  noSessions: () => Promise<string>;
}

const defaultDeps: BackfillDeps = {
  // R7: includeDegraded so an unreadable session is counted, not invisibly excluded.
  listSummaries: () => listFullSessions(undefined, { includeDegraded: true }),
  load: (summary) => loadSession(summary),
  noSessions: () => noSessionsMessage(),
};

/** R4: true when `dir` is safe to write into — absent, empty, or a prior backfill's (marker-bearing manifest). */
async function safeToWrite(dir: string): Promise<boolean> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return true; // does not exist yet — mkdir creates it
  }
  if (names.length === 0) {
    return true;
  }
  if (!names.includes("index.txt")) {
    return false;
  }
  try {
    const manifest = await readFile(join(dir, "index.txt"), "utf8");
    return manifest.split("\n", 1)[0] === MANIFEST_MARKER;
  } catch {
    return false;
  }
}

function emitSummary(ctx: CommandContext, report: BackfillReport): void {
  if (ctx.options.json) {
    ctx.stdout.write(`${JSON.stringify(backfillToJson(report), null, 2)}\n`);
  } else {
    ctx.stdout.write(`${renderBackfillSummary(report)}\n`);
  }
}

async function run(ctx: CommandContext, deps: BackfillDeps = defaultDeps): Promise<number> {
  const { options } = ctx;

  let sinceMs: number | undefined;
  if (options.since !== undefined) {
    const parsed = Date.parse(options.since);
    if (Number.isNaN(parsed)) {
      ctx.stderr.write(`invalid --since date: "${options.since}"\n`);
      return 1;
    }
    sinceMs = parsed;
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit <= 0)) {
    ctx.stderr.write("invalid --limit: expected a positive integer\n");
    return 1;
  }

  const summaries = await deps.listSummaries();
  if (summaries.length === 0) {
    // Same contract as `--list`: human message (stderr under --json so stdout
    // stays valid JSON), exit 0, no files, no export_generated event.
    if (options.json) {
      ctx.stderr.write(`${await deps.noSessions()}\n`);
      emitSummary(ctx, {
        discoveredCount: 0,
        matchedCount: 0,
        loadFailureCount: 0,
        writtenCount: 0,
        wroteFiles: false,
        outRequested: options.outDir !== undefined,
        entries: [],
      });
      return 0;
    }
    ctx.stdout.write(`${await deps.noSessions()}\n`);
    return 0;
  }

  const plan = planBackfill(summaries, { sinceMs, limit: options.limit });

  if (options.outDir === undefined || plan.entries.length === 0) {
    // R2: dry summary — no loads are attempted, so the failure count is only
    // what discovery already knows is unreadable (labelled "Known unreadable" by
    // the renderer, never claimed as a measured load result — S2 finding 1).
    // The same path serves `--out` with zero matched sessions: nothing to write,
    // so no directory, no manifest, no export event (R9 — S2 finding 2).
    const entries: BackfillReportEntry[] = plan.entries.map((e) => ({
      source: e.summary.source,
      sessionId: e.summary.id,
      title: e.summary.title ?? null,
      startedAtMs: e.summary.startedAt ?? null,
      fileName: null,
      loadFailed: e.loadFailed,
    }));
    const report: BackfillReport = {
      discoveredCount: plan.discoveredCount,
      matchedCount: plan.entries.length,
      loadFailureCount: entries.filter((e) => e.loadFailed).length,
      writtenCount: 0,
      wroteFiles: false,
      outRequested: options.outDir !== undefined,
      entries,
    };
    emitSummary(ctx, report);
    if (options.json && plan.entries.length > 0) {
      ctx.telemetry.recordExportGenerated({ surface: "backfill", format: "json", wroteFile: false, result: "success" });
    }
    return 0;
  }

  // R4: never write into a non-empty directory we cannot prove is ours.
  if (!(await safeToWrite(options.outDir))) {
    ctx.stderr.write(
      `refusing to write into ${options.outDir}: directory is not empty and has no ` +
        `aireceipts backfill manifest (index.txt starting with "${MANIFEST_MARKER}"). ` +
        `Pick an empty or new directory.\n`,
    );
    ctx.telemetry.recordExportGenerated({ surface: "backfill", format: "text", wroteFile: false, result: "invalid_args" });
    return 1;
  }

  await mkdir(options.outDir, { recursive: true });

  const entries: BackfillReportEntry[] = [];
  const written: string[] = [];
  for (const planned of plan.entries) {
    const base: Omit<BackfillReportEntry, "fileName" | "loadFailed"> = {
      source: planned.summary.source,
      sessionId: planned.summary.id,
      title: planned.summary.title ?? null,
      startedAtMs: planned.summary.startedAt ?? null,
    };
    if (planned.loadFailed) {
      entries.push({ ...base, fileName: null, loadFailed: true });
      continue;
    }
    const session = await deps.load(planned.summary);
    if (session === null) {
      // R7: an explicit load failure — counted, not dropped.
      entries.push({ ...base, fileName: null, loadFailed: true });
      continue;
    }
    const model = await buildFullSessionReceiptModel(session);
    // I5: renderer bytes + trailing newline — what `aireceipts <selector>` writes
    // with colour off and no budget configured.
    await ctx.fs.writeFile(join(options.outDir, planned.fileName), `${renderReceipt(model, { color: false })}\n`);
    written.push(planned.fileName);
    entries.push({ ...base, fileName: planned.fileName, loadFailed: false });
  }
  await ctx.fs.writeFile(join(options.outDir, "index.txt"), buildManifest(written));

  const report: BackfillReport = {
    discoveredCount: plan.discoveredCount,
    matchedCount: plan.entries.length,
    loadFailureCount: entries.filter((e) => e.loadFailed).length,
    writtenCount: written.length,
    wroteFiles: true,
    outRequested: true,
    entries,
  };
  emitSummary(ctx, report);
  ctx.telemetry.recordExportGenerated({ surface: "backfill", format: "text", wroteFile: true, result: "success" });
  await ctx.telemetry.noteMilestone("first_export", "backfill");
  return 0;
}

export { run as runBackfill };

export const command: CommandDef = {
  name: "backfill",
  priority: 55,
  matches: (options) => options.positional[0] === "backfill",
  run,
  help: {
    order: 22,
    lines: [
      "  aireceipts backfill [--since <date>] [--limit N] [--out <dir>] [--json]",
      "                                        bulk receipts for your existing session",
      "                                         history (summary only; --out writes one",
      "                                         receipt file per session + index.txt)",
    ],
  },
};
