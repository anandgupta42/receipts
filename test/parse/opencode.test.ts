import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// node:sqlite is absent on Node 20 and pre-22.5 — a static import crashes the whole
// suite at load (broke CI). Feature-detect and skip fixture-building tests where the
// module is missing; the adapter itself uses the shared sqlite.ts seam (dynamic import
// + sqlite3-CLI fallback) and stays covered on every Node via the committed fixtures.
const sqliteMod = await import("node:sqlite").then((m) => m).catch(() => null);
const DatabaseSync = sqliteMod?.DatabaseSync as typeof import("node:sqlite").DatabaseSync;
const hasNodeSqlite = sqliteMod !== null;
import { afterEach, describe, expect, it } from "vitest";
import { OpenCodeAdapter } from "../../src/parse/opencode.js";
import { buildReceiptModel, sliceSessionForReceipt } from "../../src/receipt/model.js";

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/prices");
const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/opencode");
const SIMULATION_COUNT = process.env.AIRECEIPTS_SLOW_OPENCODE === "1" ? 100 : 24;

interface SimulatedOpenCodeSession {
  sessionId: string;
  title: string;
  currentSchema: boolean;
  model: string;
  priced: boolean;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  tools: string[];
  startedAt: number;
  endedAt: number;
}

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "aireceipts-opencode-"));
}

function createSimulation(index: number): SimulatedOpenCodeSession {
  const knownModels = ["claude-haiku-4-5", "gpt-5.3-codex"];
  const priced = index % 5 < knownModels.length;
  const toolSets = [[], ["bash"], ["read", "write"], ["bash", "bash"]];
  return {
    sessionId: `ses_sim_${index.toString().padStart(3, "0")}`,
    title: `Simulated opencode session ${index.toString().padStart(3, "0")}`,
    currentSchema: index % 2 === 0,
    model: priced ? knownModels[index % knownModels.length] : `local-sim-${index}`,
    priced,
    input: 100 + index,
    output: 20 + (index % 11),
    reasoning: index % 7,
    cacheRead: index % 13,
    cacheWrite: index % 5,
    tools: toolSets[index % toolSets.length],
    startedAt: Date.parse("2026-06-30T13:00:00.000Z") + index * 10_000,
    endedAt: Date.parse("2026-06-30T13:00:00.000Z") + index * 10_000 + 5_000,
  };
}

function expectedUsage(sim: SimulatedOpenCodeSession) {
  return {
    input: sim.input,
    output: sim.output + sim.reasoning,
    cacheRead: sim.cacheRead,
    cacheCreation: sim.cacheWrite,
    total: sim.input + sim.output + sim.reasoning + sim.cacheRead + sim.cacheWrite,
  };
}

function simulatedProvider(sim: SimulatedOpenCodeSession): string {
  if (!sim.priced) return "local";
  return sim.model.startsWith("claude-") ? "anthropic" : "openai";
}

function makeSimulatedDb(dbPath: string, sims: SimulatedOpenCodeSession[]): void {
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
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);
  const insertSession = db.prepare(`
    INSERT INTO session (
      id, project_id, slug, directory, path, title, version,
      tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
      model, time_created, time_updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSessionMessage = db.prepare(
    "INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertMessage = db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)");
  const insertPart = db.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)");

  for (const sim of sims) {
    insertSession.run(
      sim.sessionId,
      "project_synthetic",
      sim.sessionId,
      `/tmp/aireceipts-opencode-sim/${sim.sessionId}`,
      `/tmp/aireceipts-opencode-sim/${sim.sessionId}`,
      sim.title,
      "0.0.0-simulated",
      sim.input,
      sim.output,
      sim.reasoning,
      sim.cacheRead,
      sim.cacheWrite,
      JSON.stringify({ id: sim.model, providerID: simulatedProvider(sim) }),
      sim.startedAt,
      sim.endedAt,
    );

    const tokens = { input: sim.input, output: sim.output, reasoning: sim.reasoning, cache: { read: sim.cacheRead, write: sim.cacheWrite } };
    if (sim.currentSchema) {
      insertSessionMessage.run(
        `${sim.sessionId}_user`,
        sim.sessionId,
        "user",
        1,
        sim.startedAt,
        sim.startedAt,
        JSON.stringify({ text: `run simulation ${sim.sessionId}`, time: { created: sim.startedAt } }),
      );
      insertSessionMessage.run(
        `${sim.sessionId}_assistant`,
        sim.sessionId,
        "assistant",
        2,
        sim.startedAt + 1_000,
        sim.endedAt,
        JSON.stringify({
          model: { id: sim.model, providerID: simulatedProvider(sim) },
          tokens,
          time: { created: sim.startedAt + 1_000, completed: sim.endedAt },
          content:
            sim.tools.length === 0
              ? [{ type: "text", text: "done" }]
              : sim.tools.map((tool, toolIndex) => ({
                  type: "tool",
                  id: `${sim.sessionId}_tool_${toolIndex}`,
                  name: tool,
                  state: { status: "completed", input: { index: toolIndex, tool }, result: `ok ${toolIndex}` },
                  time: { ran: sim.startedAt + 2_000 + toolIndex, completed: sim.startedAt + 3_000 + toolIndex },
                })),
        }),
      );
      continue;
    }

    const messageId = `${sim.sessionId}_assistant`;
    insertMessage.run(
      messageId,
      sim.sessionId,
      sim.startedAt + 1_000,
      sim.endedAt,
      JSON.stringify({
        role: "assistant",
        modelID: sim.model,
        providerID: simulatedProvider(sim),
        tokens,
        time: { created: sim.startedAt + 1_000, completed: sim.endedAt },
      }),
    );
    sim.tools.forEach((tool, toolIndex) => {
      insertPart.run(
        `${sim.sessionId}_part_${toolIndex}`,
        messageId,
        sim.sessionId,
        sim.startedAt + 2_000 + toolIndex,
        sim.startedAt + 3_000 + toolIndex,
        JSON.stringify({
          type: "tool",
          tool,
          state: { status: "completed", input: { index: toolIndex, tool }, output: `ok ${toolIndex}` },
          time: { ran: sim.startedAt + 2_000 + toolIndex, completed: sim.startedAt + 3_000 + toolIndex },
        }),
      );
    });
  }
  db.close();
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

function setCurrentSessionAggregate(
  dbPath: string,
  tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number },
): void {
  const db = new DatabaseSync(dbPath);
  db.prepare(`
    UPDATE session
    SET tokens_input = ?, tokens_output = ?, tokens_reasoning = ?,
        tokens_cache_read = ?, tokens_cache_write = ?
    WHERE id = 'ses_current_shape'
  `).run(tokens.input, tokens.output, tokens.reasoning, tokens.cacheRead, tokens.cacheWrite);
  db.close();
}

function addProviderRoutingMessages(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  const insert = db.prepare(
    "INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const t0 = Date.parse("2026-06-30T12:00:00.000Z");
  const messages = [
    { id: "msg_direct_openai", model: JSON.stringify({ id: "gpt-5.3-codex", providerID: "openai" }) },
    { id: "msg_openrouter", modelID: "gpt-5.3-codex", providerID: "openrouter" },
    { id: "msg_bedrock", model: { id: "claude-sonnet-5", providerID: "amazon-bedrock" } },
    { id: "msg_azure", modelID: "gpt-5.3-codex", providerID: "azure" },
    { id: "msg_custom", model: JSON.stringify({ id: "claude-sonnet-5", providerID: "company-proxy" }) },
  ];
  messages.forEach((message, index) => {
    const ts = t0 + 21_000 + index * 1_000;
    insert.run(
      message.id,
      "ses_current_shape",
      "assistant",
      index + 3,
      ts,
      ts + 500,
      JSON.stringify({
        ...message,
        tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: ts, completed: ts + 500 },
        content: [{ type: "text", text: "synthetic provider routing" }],
      }),
    );
  });
  db.close();
}

function addLegacySession(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);
  const t0 = Date.parse("2026-06-30T12:01:00.000Z");
  db.prepare(`
    INSERT INTO session (
      id, project_id, slug, directory, path, title, version,
      tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
      model, time_created, time_updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "ses_legacy_shape",
    "project_synthetic",
    "legacy",
    "/tmp/aireceipts-opencode-legacy",
    "/tmp/aireceipts-opencode-legacy",
    "Synthetic opencode legacy schema",
    "0.0.0-upstream/merge-v1.17.9-202606301201",
    10,
    5,
    1,
    2,
    3,
    JSON.stringify({ id: "local-big-pickle", providerID: "local" }),
    t0,
    t0 + 10_000,
  );
  db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)").run(
    "msg_legacy_asst_1",
    "ses_legacy_shape",
    t0 + 1_000,
    t0 + 8_000,
    JSON.stringify({
      role: "assistant",
      modelID: "local-big-pickle",
      tokens: { input: 10, output: 5, reasoning: 1, cache: { read: 2, write: 3 } },
      time: { created: t0 + 1_000, completed: t0 + 8_000 },
    }),
  );
  db.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)").run(
    "part_legacy_bash_1",
    "msg_legacy_asst_1",
    "ses_legacy_shape",
    t0 + 2_000,
    t0 + 3_000,
    JSON.stringify({
      type: "tool",
      tool: "bash",
      state: { status: "completed", input: { cmd: "pwd" }, output: "/tmp/aireceipts-opencode-legacy" },
      time: { ran: t0 + 2_000, completed: t0 + 3_000 },
    }),
  );
  db.close();
}

describe.skipIf(!hasNodeSqlite)("OpenCodeAdapter", () => {
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
    expect(session!.turns.map((turn) => turn.pricingProvider)).toEqual(["anthropic", "openai"]);
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
    // OpenAI cache components without a cited applicable rate contribute zero
    // to the floor; Claude's cited cache rates remain included.
    expect(model.totalUsd).toBeCloseTo(0.00966875, 12);
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

  it("preserves a larger session aggregate as explicit unpriced residual usage", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const dbPath = path.join(dir, "opencode-aggregate-residual.db");
    makeSessionMessageDb(dbPath);
    // Itemized assistant usage is 500 input, 125 output+reasoning, 50 read,
    // 10 write. The projector knows more than the message row in every bucket.
    setCurrentSessionAggregate(dbPath, { input: 650, output: 150, reasoning: 25, cacheRead: 90, cacheWrite: 30 });

    const session = await new OpenCodeAdapter({ dbPath }).loadSession(dbPath);
    expect(session).not.toBeNull();
    expect(session!.totals.tokens).toMatchObject({
      input: 650,
      output: 175,
      cacheRead: 90,
      cacheCreation: 30,
      total: 945,
    });
    // Aggregate-only usage stays outside the turn/model domain: no synthetic
    // request is invented merely to make downstream arithmetic reconcile.
    expect(session!.totals.turnCount).toBe(1);
    expect(session!.turns).toHaveLength(1);
    expect(session!.unattributedUsage).toMatchObject({
      input: 150,
      output: 50,
      cacheRead: 40,
      cacheCreation: 20,
      total: 260,
    });

    const receipt = await buildReceiptModel(session!, dataDir);
    expect(receipt.totalTokens.total).toBe(945);
    expect(receipt.unpricedTokens?.total).toBe(260);
    expect(receipt.totalUsd).not.toBeNull();
    expect(receipt.caveats).toContainEqual(
      expect.objectContaining({ kind: "unattributed-aggregate-usage", text: expect.stringContaining("260 unattributed tokens") }),
    );
    expect(receipt.caveats.some((c) => c.kind === "partial-priced-coverage")).toBe(false);
    expect(receipt.toolRows).toContainEqual(expect.objectContaining({ tool: "(unattributed usage)", usd: null, callCount: 0 }));
    expect(receipt.modelMix).toContainEqual(expect.objectContaining({ model: "(unattributed usage)", usd: null }));

    const twoTurnSession = {
      ...session!,
      turns: [...session!.turns, { index: 1, toolCalls: [] }],
      totals: { ...session!.totals, turnCount: 2 },
    };
    const slice = sliceSessionForReceipt(twoTurnSession, { startTurn: 0, endTurn: 0 });
    expect(slice.unattributedUsage).toBeUndefined();
    expect(slice.excludedUnattributedUsage?.total).toBe(260);
    expect(slice.totals.tokens.total).toBe(685);
    const slicedReceipt = await buildReceiptModel(slice, dataDir);
    expect(slicedReceipt.caveats).toContainEqual(
      expect.objectContaining({ kind: "unattributed-aggregate-usage", text: expect.stringContaining("cannot be assigned to this slice") }),
    );
  });

  it("does not splice crossed aggregate and itemized vectors into a fabricated total", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const dbPath = path.join(dir, "opencode-conflicting-aggregate.db");
    makeSessionMessageDb(dbPath);
    // Itemized = 500 input, 125 output, 50 read, 10 write. The aggregate is
    // larger overall and in output/read/write, but smaller in input. Adding
    // only its positive deltas would create a vector reported by neither side.
    setCurrentSessionAggregate(dbPath, { input: 400, output: 300, reasoning: 25, cacheRead: 90, cacheWrite: 30 });

    const session = await new OpenCodeAdapter({ dbPath }).loadSession(dbPath);
    expect(session).not.toBeNull();
    expect(session!.totals.tokens).toMatchObject({
      input: 500,
      output: 125,
      cacheRead: 50,
      cacheCreation: 10,
      total: 685,
    });
    expect(session!.unattributedUsage).toBeUndefined();
    expect(session!.conflictingAggregateUsage).toMatchObject({
      input: 0,
      output: 200,
      cacheRead: 40,
      cacheCreation: 20,
      total: 260,
    });

    const receipt = await buildReceiptModel(session!, dataDir);
    expect(receipt.totalTokens.total).toBe(685);
    expect(receipt.caveats).toContainEqual(
      expect.objectContaining({
        kind: "unattributed-aggregate-usage",
        text: expect.stringContaining("conflict with itemized components"),
      }),
    );
  });

  it("does not inherit missing request identity from OpenCode session metadata", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const dbPath = path.join(dir, "opencode-missing-request-identity.db");
    makeSessionMessageDb(dbPath);
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE session SET model = ? WHERE id = 'ses_current_shape'").run(
      JSON.stringify({ id: "gpt-5.3-codex", providerID: "openai" }),
    );
    const t0 = Date.parse("2026-06-30T12:00:00.000Z");
    db.prepare("UPDATE session_message SET data = ? WHERE id = 'msg_asst_1'").run(
      JSON.stringify({
        // Deliberately no message-level modelID/model/providerID. A later or
        // session-wide direct identity cannot prove this request's route.
        tokens: { input: 500, output: 100, reasoning: 25, cache: { read: 50, write: 10 } },
        time: { created: t0 + 5_000, completed: t0 + 20_000 },
        content: [{ type: "text", text: "identity omitted" }],
      }),
    );
    db.close();

    const session = await new OpenCodeAdapter({ dbPath }).loadSession(dbPath);
    expect(session).not.toBeNull();
    expect(session!.model).toBe("gpt-5.3-codex");
    expect(session!.turns[0].model).toBeUndefined();
    expect(session!.turns[0].pricingProvider).toBeNull();
    expect((await buildReceiptModel(session!, dataDir)).totalUsd).toBeNull();
  });

  it("prices only explicit direct providers and blocks routed/custom provider IDs", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const dbPath = path.join(dir, "opencode-providers.db");
    makeSessionMessageDb(dbPath);
    addProviderRoutingMessages(dbPath);
    const session = await new OpenCodeAdapter({ dbPath }).loadSession(dbPath);

    expect(session).not.toBeNull();
    expect(session!.turns.map((turn) => turn.pricingProvider)).toEqual([
      "anthropic",
      "openai",
      null,
      null,
      null,
      null,
    ]);
    expect(session!.turns.map((turn) => turn.model)).toEqual([
      "claude-sonnet-5",
      "gpt-5.3-codex",
      "gpt-5.3-codex",
      "claude-sonnet-5",
      "gpt-5.3-codex",
      "claude-sonnet-5",
    ]);

    const receipt = await buildReceiptModel(session!, dataDir);
    // Direct Claude = $0.002285; direct OpenAI = $0.000315. The four
    // routed/custom turns retain 440 tokens but contribute no guessed dollars.
    expect(receipt.totalUsd).toBeCloseTo(0.0026, 12);
    expect(receipt.totalTokens.total).toBe(1_235);
    expect(receipt.unpricedTokens?.total).toBe(440);
    expect(receipt.priceRowsUsed.map((row) => `${row.vendor}:${row.model}`).sort()).toEqual([
      "anthropic:claude-sonnet-5",
      "openai:gpt-5.3-codex",
    ]);
    expect(receipt.caveats).toContainEqual(
      expect.objectContaining({ kind: "partial-priced-coverage", text: expect.stringContaining("4 of 6 usage turns include unpriced tokens") }),
    );
  });

  it("falls back to legacy message/part rows when session_message exists but is empty", async () => {
    const dbPath = path.join(fixturesDir, "legacy-empty-session-message.db");
    const adapter = new OpenCodeAdapter({ dbPath });

    const summaries = await adapter.listSessions({ full: true });
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      source: "opencode",
      title: "Legacy rows with empty session_message",
      model: "big-pickle",
      cwd: "/tmp/aireceipts-opencode-loop",
      totals: {
        turnCount: 3,
        toolCallCount: 2,
      },
    });
    expect(summaries[0].totals.tokens).toMatchObject({
      input: 12091,
      output: 173,
      cacheRead: 24064,
      cacheCreation: 0,
      total: 36328,
    });

    const session = await adapter.loadSession(`${dbPath}#ses_legacy_empty_current`);
    expect(session).not.toBeNull();
    expect(session!.turns).toHaveLength(3);
    expect(session!.turns.map((turn) => turn.toolCalls.map((call) => call.name))).toEqual([["write"], ["bash"], []]);
    expect(session!.turns[0].toolCalls[0]).toMatchObject({
      name: "write",
      input: {
        filePath: "/tmp/aireceipts-opencode-loop/opencode-loop.txt",
        content: "opencode adapter corpus loop",
      },
      output: "Wrote file successfully.",
      status: "ok",
      startedAt: 1783120106048,
      endedAt: 1783120106056,
    });
    expect(session!.turns[1].toolCalls[0]).toMatchObject({
      name: "bash",
      input: { command: "cat opencode-loop.txt" },
      output: "opencode adapter corpus loop",
      status: "ok",
      startedAt: 1783120107688,
      endedAt: 1783120107691,
    });

    const model = await buildReceiptModel(session!, dataDir);
    expect(model.totalTokens).toMatchObject({
      input: 12091,
      output: 173,
      cacheRead: 24064,
      cacheCreation: 0,
      total: 36328,
    });
    expect(model.totalUsd).toBeNull();
    expect(model.toolRows.map((row) => row.tool)).toContain("write");
    expect(model.toolRows.map((row) => row.tool)).toContain("bash");
  });

  it("chooses current or legacy rows per session in mixed-schema databases", async () => {
    const dir = tempDir();
    dirs.push(dir);
    const dbPath = path.join(dir, "opencode-mixed-schema.db");
    makeSessionMessageDb(dbPath);
    addLegacySession(dbPath);
    const adapter = new OpenCodeAdapter({ dbPath });

    const summaries = await adapter.listSessions();
    expect(summaries.map((summary) => [summary.title, summary.totals.turnCount, summary.totals.toolCallCount])).toEqual([
      ["Synthetic opencode legacy schema", 1, 1],
      ["Synthetic opencode current schema", 1, 1],
    ]);

    const newest = await adapter.loadSession(dbPath);
    expect(newest).not.toBeNull();
    expect(newest!.title).toBe("Synthetic opencode legacy schema");
    expect(newest!.turns).toHaveLength(1);
    expect(newest!.turns[0]).toMatchObject({
      model: "local-big-pickle",
      usage: { input: 10, output: 6, cacheRead: 2, cacheCreation: 3, total: 21 },
    });
    expect(newest!.turns[0].toolCalls[0]).toMatchObject({
      name: "bash",
      input: { cmd: "pwd" },
      output: "/tmp/aireceipts-opencode-legacy",
    });
  });

  // 24 sessions cover the full structural combination cycle (LCM of the
  // priced/schema/model/tool mods is 20). Set AIRECEIPTS_SLOW_OPENCODE=1 for a
  // 100-session local stress run. Every summary is validated from a SINGLE
  // `listSessions()` (one DB open); the deeper `loadSession` +
  // `buildReceiptModel` round-trip — each of which reopens the SQLite DB — runs
  // only on a representative SAMPLE spanning priced/unpriced × every tool set ×
  // both schema flags. This keeps combinatorial coverage while bounding DB
  // reopens (list-all, sample-deep, the same shape as the e2e test), so it no
  // longer times out under the full suite's concurrent load on dev machines.
  it(`validates ${SIMULATION_COUNT} generated opencode schema/model/tool combinations`, async () => {
    const dir = tempDir();
    dirs.push(dir);
    const dbPath = path.join(dir, `opencode-${SIMULATION_COUNT}-simulations.db`);
    const simulations = Array.from({ length: SIMULATION_COUNT }, (_, index) => createSimulation(index));
    makeSimulatedDb(dbPath, simulations);
    const adapter = new OpenCodeAdapter({ dbPath });

    const summaries = await adapter.listSessions();
    expect(summaries).toHaveLength(SIMULATION_COUNT);
    expect(summaries[0].title).toBe(simulations.at(-1)!.title);

    // Summary-level validation for ALL simulations — the single listSessions()
    // above already parsed every session's model, token totals, and tool count.
    const summariesByTitle = new Map(summaries.map((summary) => [summary.title, summary]));
    for (const sim of simulations) {
      const expected = expectedUsage(sim);
      const summary = summariesByTitle.get(sim.title);
      expect(summary, sim.title).toBeDefined();
      expect(summary!.model).toBe(sim.model);
      expect(summary!.totals).toMatchObject({ turnCount: 1, toolCallCount: sim.tools.length });
      expect(summary!.totals.tokens).toMatchObject(expected);
    }

    // Deep round-trip (reopens the DB per call) only for a sample covering both
    // priced states, all four tool sets, and both schema flags — indices 0-4
    // span exactly that per createSimulation's mod cycles.
    const sampleIndices = [0, 1, 2, 3, 4];
    for (const index of sampleIndices) {
      const sim = simulations[index];
      const expected = expectedUsage(sim);
      const session = await adapter.loadSession(`${dbPath}#${sim.sessionId}`);
      expect(session, sim.title).not.toBeNull();
      expect(session!.turns).toHaveLength(1);
      expect(session!.turns[0]).toMatchObject({ model: sim.model, usage: expected });
      expect(session!.turns[0].toolCalls.map((call) => call.name)).toEqual(sim.tools);

      const receipt = await buildReceiptModel(session!, dataDir);
      expect(receipt.totalTokens).toMatchObject(expected);
      if (sim.priced) {
        expect(receipt.totalUsd, sim.title).toBeGreaterThan(0);
        expect(receipt.priceRowsUsed.map((row) => row.model)).toEqual([sim.model]);
      } else {
        expect(receipt.totalUsd, sim.title).toBeNull();
        expect(receipt.priceRowsUsed).toEqual([]);
      }
      expect(receipt.toolRows.reduce((sum, row) => sum + row.callCount, 0)).toBe(Math.max(1, sim.tools.length));
    }
  }, process.env.AIRECEIPTS_SLOW_OPENCODE === "1" ? 300_000 : 90_000);

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
