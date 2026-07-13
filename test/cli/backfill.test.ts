// SPEC-0056 — the `backfill` command end-to-end over injected discovery/load
// seams: summary-only without `--out` (R2), renderer-byte files + marker manifest
// with `--out` (R3), the refuse-to-clobber guard (R4), byte-identical re-runs
// (R5), flag validation (R6), honest load-failure counting (R7), the versioned
// JSON summary (R8), and the export_generated decision tree (R9).
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { writeFile as realWriteFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseOptions } from "../../src/cli/options.js";
import type { CommandContext } from "../../src/cli/types.js";
import { command as backfillCommand, runBackfill } from "../../src/cli/commands/backfill.js";
import type { BackfillDeps } from "../../src/cli/commands/backfill.js";
import { MANIFEST_MARKER } from "../../src/aggregate/backfill.js";
import { backfillJsonSchema } from "../../src/receipt/exportSchema.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { renderReceipt } from "../../src/receipt/render.js";
import { loadById } from "../../src/parse/load.js";
import { toCommandTelemetry } from "../../src/telemetry/helpers.js";
import { COMMAND_VALUES, EXPORT_FORMAT_VALUES, EXPORT_SURFACE_VALUES } from "../../src/telemetry/schemas.js";
import type { AgentSource, Session, SessionSummary, TokenUsage, Turn } from "../../src/parse/types.js";

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
const DAY = 86_400_000;

function usage(input: number): TokenUsage {
  return { input, output: 0, cacheRead: 0, cacheCreation: 0, total: input };
}

function session(id: string, source: AgentSource, tok: number, endedAt: number): Session {
  const u = usage(tok);
  const turn: Turn = { index: 0, timestamp: endedAt, model: "claude-sonnet-5", usage: u, toolCalls: [] };
  return {
    id,
    source,
    filePath: `/u/.claude/projects/x/${id}.jsonl`,
    startedAt: endedAt,
    endedAt,
    totals: { tokens: u, turnCount: 1, toolCallCount: 0 },
    turns: [turn],
  };
}

function summaryOf(s: Session, extra: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: s.id,
    source: s.source,
    filePath: s.filePath,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    totals: s.totals,
    ...extra,
  };
}

interface ExportEvent {
  surface: string;
  format: string;
  wroteFile: boolean;
  result: string;
}

function fakeContext(argv: string[], opts: { realFs?: boolean } = {}) {
  let out = "";
  let err = "";
  const writes = new Map<string, string>();
  const exports: ExportEvent[] = [];
  const milestones: string[] = [];
  const ctx: CommandContext = {
    options: parseOptions(argv),
    stdin: process.stdin,
    stdout: { write: (s: string) => ((out += s), true) } as unknown as NodeJS.WriteStream,
    stderr: { write: (s: string) => ((err += s), true) } as unknown as NodeJS.WriteStream,
    env: {},
    cwd: () => process.cwd(),
    now: () => NOW,
    fs: {
      writeFile: async (path, data) => {
        writes.set(path, String(data));
        if (opts.realFs) {
          await realWriteFile(path, data);
        }
      },
    },
    prompt: async () => false,
    telemetry: {
      showPayload: () => ({ enabled: false, events: [] }),
      noteReceiptGenerated: async () => {},
      recordExportGenerated: (input) => {
        exports.push(input as unknown as ExportEvent);
      },
      recordPrFlowCompleted: () => {},
      recordHookConfigured: () => {},
      recordIntegrationSurfaceRendered: () => {},
      recordReviewPatternEvaluated: () => {},
      noteMilestone: async (m) => {
        milestones.push(m);
      },
    },
    renderHelp: () => "",
  };
  return { ctx, out: () => out, err: () => err, writes, exports, milestones };
}

const s1 = session("newest-session", "claude-code", 1_000_000, NOW - DAY);
const s2 = session("older-session", "codex", 500_000, NOW - 3 * DAY);

function deps(sessions: Session[], extraSummaries: SessionSummary[] = [], failIds: string[] = []): BackfillDeps {
  const summaries = [...sessions.map((s) => summaryOf(s)), ...extraSummaries];
  return {
    listSummaries: async () => summaries,
    load: async (summary) => {
      if (failIds.includes(summary.id)) {
        return null;
      }
      return sessions.find((s) => s.id === summary.id) ?? null;
    },
    // The real noSessionsMessage() re-scans agent roots on disk; keep the test hermetic.
    noSessions: async () => "no sessions found\nNo sessions yet? Run `aireceipts --demo` to see a sample receipt.",
  };
}

const tempDirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aireceipts-backfill-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("parse — backfill (R1)", () => {
  it("recognizes `backfill` as a subcommand and registers between list and pr", async () => {
    const { resolveCommand } = await import("../../src/cli/args.js");
    expect(await resolveCommand(["backfill"])).toBe("backfill");
    expect(backfillCommand.priority).toBeGreaterThan(50);
    expect(backfillCommand.priority).toBeLessThan(60);
  });

  it("parses --limit and --out in spaced and = forms", () => {
    expect(parseOptions(["backfill", "--limit", "3"]).limit).toBe(3);
    expect(parseOptions(["backfill", "--limit=7"]).limit).toBe(7);
    expect(parseOptions(["backfill", "--out", "/tmp/x"]).outDir).toBe("/tmp/x");
    expect(parseOptions(["backfill", "--out=/tmp/y"]).outDir).toBe("/tmp/y");
    expect(parseOptions([]).limit).toBeUndefined();
    expect(parseOptions([]).outDir).toBeUndefined();
  });

  it("R9: backfill is a telemetry command value; surface/format enums extended", () => {
    expect((COMMAND_VALUES as readonly string[]).includes("backfill")).toBe(true);
    expect(toCommandTelemetry("backfill")).toBe("backfill");
    expect((EXPORT_SURFACE_VALUES as readonly string[]).includes("backfill")).toBe(true);
    expect((EXPORT_FORMAT_VALUES as readonly string[]).includes("text")).toBe(true);
  });
});

describe("backfill without --out (R2)", () => {
  it("prints a summary, writes nothing, fires no export event", async () => {
    const { ctx, out, writes, exports } = fakeContext(["backfill"]);
    expect(await runBackfill(ctx, deps([s1, s2]))).toBe(0);
    expect(out()).toContain("BACKFILL");
    expect(out()).toContain("Sessions discovered");
    expect(out()).toContain("dry run");
    expect(writes.size).toBe(0);
    expect(exports).toEqual([]);
  });

  it("R7: never loads a transcript on a dry run and labels the figure 'Known unreadable'", async () => {
    const degraded = summaryOf(session("unreadable", "claude-code", 0, NOW - 5 * DAY), { degraded: "unreadable" });
    const base = deps([s1], [degraded]);
    let loadCalls = 0;
    const spied = { ...base, load: async (s: SessionSummary) => (loadCalls++, base.load(s)) };
    const { ctx, out } = fakeContext(["backfill"]);
    expect(await runBackfill(ctx, spied)).toBe(0);
    expect(loadCalls).toBe(0);
    // I3: a dry run never claims a measured "Load failures" — only the known lower bound.
    expect(out()).toContain("Known unreadable");
    expect(out()).not.toContain("Load failures");
  });

  it("--json emits a schema-valid, fixed-key-order object and one json export event", async () => {
    const { ctx, out, writes, exports } = fakeContext(["backfill", "--json"]);
    expect(await runBackfill(ctx, deps([s1, s2]))).toBe(0);
    const json = JSON.parse(out());
    expect(Object.keys(json)).toEqual([
      "schemaVersion",
      "discoveredCount",
      "matchedCount",
      "loadFailureCount",
      "writtenCount",
      "wroteFiles",
      "sessions",
    ]);
    expect(backfillJsonSchema.safeParse(json).success).toBe(true);
    expect(json.discoveredCount).toBe(2);
    expect(json.writtenCount).toBe(0);
    expect(json.wroteFiles).toBe(false);
    expect(json.sessions.map((s: { fileName: string | null }) => s.fileName)).toEqual([null, null]);
    expect(writes.size).toBe(0);
    expect(exports).toEqual([{ surface: "backfill", format: "json", wroteFile: false, result: "success" }]);
  });

  it("zero sessions: --list's message family, exit 0, no export event; --json stdout stays JSON", async () => {
    const bare = fakeContext(["backfill"]);
    expect(await runBackfill(bare.ctx, deps([]))).toBe(0);
    expect(bare.out()).toMatch(/no agent session data detected|no sessions found/u);
    expect(bare.exports).toEqual([]);

    const json = fakeContext(["backfill", "--json"]);
    expect(await runBackfill(json.ctx, deps([]))).toBe(0);
    expect(json.err()).toMatch(/no agent session data detected|no sessions found/u);
    expect(JSON.parse(json.out()).matchedCount).toBe(0);
    expect(json.exports).toEqual([]);
  });
});

describe("backfill --out (R3/R5/R9)", () => {
  it("writes a full-session receipt with each discovered subagent included once", async () => {
    const parent = await loadById("claude-code", "test/fixtures/claude-code/clean-with-subagents.jsonl");
    expect(parent).not.toBeNull();
    const dir = await tempDir();
    const { ctx, writes } = fakeContext(["backfill", "--out", dir]);
    expect(await runBackfill(ctx, deps([parent!]))).toBe(0);
    const receipt = [...writes.entries()].find(([file]) => file.endsWith(".txt") && !file.endsWith("index.txt"))?.[1];
    expect(receipt?.match(/SUBAGENTS \(2\)/gu)).toHaveLength(1);
  });

  it("writes one renderer-byte receipt per session plus a marker manifest", async () => {
    const dir = await tempDir();
    const { ctx, out, writes, exports, milestones } = fakeContext(["backfill", "--out", dir]);
    expect(await runBackfill(ctx, deps([s1, s2]))).toBe(0);

    // I5: EVERY written file is exact renderer bytes + trailing newline.
    const expected1 = `${renderReceipt(await buildReceiptModel(s1), { color: false })}\n`;
    const expected2 = `${renderReceipt(await buildReceiptModel(s2), { color: false })}\n`;
    expect(writes.get(join(dir, "1-claude-code-newest-session.txt"))).toBe(expected1);
    expect(writes.get(join(dir, "2-codex-older-session.txt"))).toBe(expected2);

    const manifest = writes.get(join(dir, "index.txt"));
    expect(manifest).toBe(`${MANIFEST_MARKER}\n1-claude-code-newest-session.txt\n2-codex-older-session.txt\n`);

    expect(out()).toContain("Receipts written");
    expect(out()).toContain("Load failures");
    expect(exports).toEqual([{ surface: "backfill", format: "text", wroteFile: true, result: "success" }]);
    expect(milestones).toEqual(["first_export"]);
  });

  it("zero-match --out: writes nothing (no manifest, no dir), says so, fires no export event", async () => {
    const dir = await tempDir();
    const target = join(dir, "never-created");
    const future = new Date(NOW + DAY).toISOString();
    const { ctx, out, writes, exports, milestones } = fakeContext(["backfill", "--out", target, "--since", future]);
    expect(await runBackfill(ctx, deps([s1, s2]))).toBe(0);
    expect(writes.size).toBe(0);
    expect((await readdir(dir))).toEqual([]);
    expect(out()).toContain("no sessions matched the filters; nothing written.");
    expect(exports).toEqual([]);
    expect(milestones).toEqual([]);
  });

  it("R5: an identical re-run reproduces byte-identical files", async () => {
    const dir = await tempDir();
    const first = fakeContext(["backfill", "--out", dir], { realFs: true });
    expect(await runBackfill(first.ctx, deps([s1, s2]))).toBe(0);
    const second = fakeContext(["backfill", "--out", dir], { realFs: true });
    expect(await runBackfill(second.ctx, deps([s1, s2]))).toBe(0);
    expect([...second.writes.keys()].sort()).toEqual([...first.writes.keys()].sort());
    for (const [path, bytes] of second.writes) {
      expect(bytes).toBe(first.writes.get(path));
    }
    expect((await readdir(dir)).sort()).toEqual(["1-claude-code-newest-session.txt", "2-codex-older-session.txt", "index.txt"]);
  });

  it("R7: a degraded summary and a null load are both counted as load failures, not written", async () => {
    const dir = await tempDir();
    const degraded = summaryOf(session("unreadable", "claude-code", 0, NOW - 5 * DAY), { degraded: "unreadable" });
    const { ctx, out, writes } = fakeContext(["backfill", "--out", dir, "--json"]);
    expect(await runBackfill(ctx, deps([s1, s2], [degraded], ["older-session"]))).toBe(0);
    const json = JSON.parse(out());
    expect(json.matchedCount).toBe(3);
    expect(json.loadFailureCount).toBe(2);
    expect(json.writtenCount).toBe(1);
    const byId = new Map(json.sessions.map((s: { sessionId: string; loadFailed: boolean }) => [s.sessionId, s.loadFailed]));
    expect(byId.get("unreadable")).toBe(true);
    expect(byId.get("older-session")).toBe(true);
    expect(byId.get("newest-session")).toBe(false);
    // Manifest lists only the written file.
    const manifest = writes.get(join(dir, "index.txt"));
    expect(manifest?.split("\n").filter((l) => l.endsWith(".txt"))).toEqual(["1-claude-code-newest-session.txt"]);
  });
});

describe("refuse to clobber (R4)", () => {
  it("refuses a non-empty directory without a marker manifest: exit 1, nothing written, invalid_args", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "unrelated.txt"), "hands off", "utf8");
    const { ctx, err, writes, exports } = fakeContext(["backfill", "--out", dir]);
    expect(await runBackfill(ctx, deps([s1]))).toBe(1);
    expect(err()).toContain("refusing to write");
    expect(writes.size).toBe(0);
    expect(exports).toEqual([{ surface: "backfill", format: "text", wroteFile: false, result: "invalid_args" }]);
  });

  it("refuses when index.txt exists but lacks the marker line", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "index.txt"), "someone else's index\n", "utf8");
    const { ctx, writes } = fakeContext(["backfill", "--out", dir]);
    expect(await runBackfill(ctx, deps([s1]))).toBe(1);
    expect(writes.size).toBe(0);
  });

  it("proceeds when the directory holds a prior backfill's marker-bearing manifest", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "index.txt"), `${MANIFEST_MARKER}\nold.txt\n`, "utf8");
    await writeFile(join(dir, "old.txt"), "stale receipt", "utf8");
    const { ctx, writes } = fakeContext(["backfill", "--out", dir]);
    expect(await runBackfill(ctx, deps([s1]))).toBe(0);
    expect(writes.size).toBeGreaterThan(0);
  });
});

describe("flag validation and filters (R6)", () => {
  it("rejects an unparseable --since: exit 1, nothing written", async () => {
    const { ctx, err, writes, exports } = fakeContext(["backfill", "--since", "not-a-date"]);
    expect(await runBackfill(ctx, deps([s1]))).toBe(1);
    expect(err()).toContain("invalid --since");
    expect(writes.size).toBe(0);
    expect(exports).toEqual([]);
  });

  it.each([["0"], ["-3"], ["2.5"], ["abc"]])("rejects --limit %s: exit 1", async (bad) => {
    const { ctx, err } = fakeContext(["backfill", "--limit", bad]);
    expect(await runBackfill(ctx, deps([s1]))).toBe(1);
    expect(err()).toContain("invalid --limit");
  });

  it("--since drops sessions that ended before the cutoff; --limit caps the rest", async () => {
    const { ctx, out } = fakeContext(["backfill", "--json", "--since", new Date(NOW - 2 * DAY).toISOString()]);
    expect(await runBackfill(ctx, deps([s1, s2]))).toBe(0);
    const json = JSON.parse(out());
    expect(json.matchedCount).toBe(1);
    expect(json.sessions[0].sessionId).toBe("newest-session");

    const limited = fakeContext(["backfill", "--json", "--limit", "1"]);
    expect(await runBackfill(limited.ctx, deps([s1, s2]))).toBe(0);
    expect(JSON.parse(limited.out()).matchedCount).toBe(1);
  });
});
