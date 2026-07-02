import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { OpenCodeAdapter } from "../../src/parse/opencode.js";
import { buildReceiptModel } from "../../src/receipt/model.js";

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/prices");
const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/opencode");

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "aireceipts-opencode-"));
}

function makeSessionMessageDb(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      path TEXT,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      cost REAL DEFAULT 0 NOT NULL,
      tokens_input INTEGER DEFAULT 0 NOT NULL,
      tokens_output INTEGER DEFAULT 0 NOT NULL,
      tokens_reasoning INTEGER DEFAULT 0 NOT NULL,
      tokens_cache_read INTEGER DEFAULT 0 NOT NULL,
      tokens_cache_write INTEGER DEFAULT 0 NOT NULL,
      model TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
    CREATE TABLE session_message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      seq INTEGER NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);
  const t0 = Date.parse("2026-06-30T12:00:00.000Z");
  db.prepare(`
    INSERT INTO session (
      id, project_id, slug, directory, path, title, version, time_created, time_updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "ses_current_shape",
    "project_synthetic",
    "current",
    "/tmp/aireceipts-opencode-current",
    "/tmp/aireceipts-opencode-current",
    "Synthetic opencode current schema",
    "0.0.0-upstream/merge-v1.17.9-202606301200",
    t0,
    t0 + 20_000,
  );
  const insert = db.prepare(
    "INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  insert.run(
    "msg_user_1",
    "ses_current_shape",
    "user",
    1,
    t0,
    t0,
    JSON.stringify({ text: "synthetic user text", time: { created: t0 } }),
  );
  insert.run(
    "msg_asst_1",
    "ses_current_shape",
    "assistant",
    2,
    t0 + 5_000,
    t0 + 20_000,
    JSON.stringify({
      model: { id: "claude-sonnet-5", providerID: "anthropic" },
      tokens: { input: 500, output: 100, reasoning: 25, cache: { read: 50, write: 10 } },
      time: { created: t0 + 5_000, completed: t0 + 20_000 },
      content: [
        { type: "text", text: "synthetic assistant text" },
        {
          type: "tool",
          name: "bash",
          state: { status: "completed", input: "{\"command\":\"npm test\"}", result: "ok" },
          time: { ran: t0 + 8_000, completed: t0 + 18_000 },
        },
      ],
    }),
  );
  db.close();
}

describe("OpenCodeAdapter", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses per-message opencode usage and tool parts into priced turns", async () => {
    const dbPath = path.join(fixturesDir, "clean-multi-vendor.db");
    const adapter = new OpenCodeAdapter({ dbPath });

    const summaries = await adapter.listSessions({ full: true });
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      source: "opencode",
      title: "Port parser adapter",
      model: "claude-haiku-4-5",
      totals: {
        turnCount: 2,
        toolCallCount: 2,
      },
    });
    expect(summaries[0].totals.tokens).toMatchObject({
      input: 2200,
      output: 700,
      cacheRead: 150,
      cacheCreation: 90,
      total: 3140,
    });

    const session = await adapter.loadSession(dbPath);
    expect(session).not.toBeNull();
    expect(session!.turns).toHaveLength(2);
    expect(session!.turns[0]).toMatchObject({
      model: "claude-haiku-4-5",
      usage: { input: 1200, output: 350, cacheRead: 100, cacheCreation: 40, total: 1690 },
      outputTokens: 350,
    });
    expect(session!.turns[0].toolCalls[0]).toMatchObject({
      name: "read",
      input: { file: "src/parse/types.ts" },
      output: "ok",
      status: "ok",
    });

    const model = await buildReceiptModel(session!, dataDir);
    expect(model.totalUsd).toBeCloseTo(0.00975625, 12);
    expect(model.priceRowsUsed.map((row) => `${row.vendor}:${row.model}`).sort()).toEqual([
      "anthropic:claude-haiku-4-5",
      "openai:gpt-5.3-codex",
    ]);
  });

  it("surfaces repeated opencode tool calls for stuck-loop detection", async () => {
    const dbPath = path.join(fixturesDir, "loop-shell-3x.db");
    const adapter = new OpenCodeAdapter({ dbPath });

    const session = await adapter.loadSession(dbPath);
    expect(session).not.toBeNull();
    expect(session!.turns).toHaveLength(3);
    expect(session!.turns.map((turn) => turn.toolCalls[0]?.input)).toEqual([
      { cmd: "npm install" },
      { cmd: "npm install" },
      { cmd: "npm install" },
    ]);

    const model = await buildReceiptModel(session!, dataDir);
    expect(model.wasteLines).toContainEqual(
      expect.objectContaining({ kind: "stuck-loop", tool: "bash", runLength: 3 }),
    );
  });

  it("parses opencode session_message rows when that schema is present", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const dbPath = path.join(dir, "opencode-current.db");
    makeSessionMessageDb(dbPath);
    const adapter = new OpenCodeAdapter({ dbPath });

    const session = await adapter.loadSession(dbPath);
    expect(session).not.toBeNull();
    expect(session!.model).toBe("claude-sonnet-5");
    expect(session!.totals).toMatchObject({ turnCount: 1, toolCallCount: 1 });
    expect(session!.totals.tokens).toMatchObject({ input: 500, output: 125, cacheRead: 50, cacheCreation: 10, total: 685 });
    expect(session!.turns[0].toolCalls[0]).toMatchObject({
      name: "bash",
      input: { command: "npm test" },
      output: "ok",
      status: "ok",
    });
  });

  it("degrades invalid SQLite files to no sessions and null loads", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const dbPath = path.join(dir, "opencode-bad.db");
    writeFileSync(dbPath, "not sqlite");
    const adapter = new OpenCodeAdapter({ dbPath });

    await expect(adapter.detect()).resolves.toBe(false);
    await expect(adapter.listSessions()).resolves.toEqual([]);
    await expect(adapter.loadSession(dbPath)).resolves.toBeNull();
  });
});
