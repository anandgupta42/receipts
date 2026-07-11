// One observable assistant response group = one turn. Claude Code writes one `assistant`
// record per content block. Same-id usage is often identical, but Anthropic's
// Agent SDK guidance explicitly says duplicate ids can report evolving output
// and the highest output value identifies the accurate response. These tests
// pin both sides: group once by id, retain that record's coherent usage vector,
// and preserve each distinct tool use/result exactly once.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadById } from "../../src/parse/load.js";
import { buildReceiptModel } from "../../src/receipt/model.js";

const SESS = "dddddddd-1111-2222-3333-555555555555";
const EVOLVING_FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "claude-code",
  "evolving-duplicate-snapshots.jsonl",
);

type Rec = Record<string, unknown>;

const USAGE = {
  input_tokens: 100,
  output_tokens: 50,
  cache_read_input_tokens: 1_000,
  cache_creation_input_tokens: 200,
};

/** `usage: null` omits the field entirely (a usage-less record). */
function assistantRecord(
  uuid: string,
  ts: string,
  messageId: string,
  content: unknown[],
  usage: Record<string, unknown> | null = USAGE,
): Rec {
  return {
    type: "assistant",
    uuid,
    parentUuid: null,
    isSidechain: false,
    timestamp: `2026-07-04T${ts}Z`,
    sessionId: SESS,
    cwd: "/home/dev/repo",
    message: { id: messageId, type: "message", role: "assistant", model: "claude-opus-4-8", content, ...(usage ? { usage } : {}) },
  };
}

const tmpDirs: string[] = [];
afterAll(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function loadFixture(records: Rec[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aireceipts-dedupe-"));
  tmpDirs.push(dir);
  const file = path.join(dir, `${SESS}.jsonl`);
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const session = await loadById("claude-code", file);
  expect(session).not.toBeNull();
  return session!;
}

describe("claude-code adapter: one observable response group = one turn (message-id dedupe)", () => {
  it("merges multi-record responses into one turn and books usage once", async () => {
    const session = await loadFixture([
      { type: "user", uuid: "u-1", timestamp: "10:00:00.000", sessionId: SESS, message: { role: "user", content: "do the thing" } },
      // One response (msg_a) split across three records — text, then two tool_use
      // blocks — each repeating the identical usage snapshot, as Claude Code writes it.
      assistantRecord("a-1", "10:00:05.000", "msg_a", [{ type: "text", text: "on it" }]),
      assistantRecord("a-2", "10:00:06.000", "msg_a", [{ type: "tool_use", id: "t-1", name: "Bash", input: { command: "ls" } }]),
      assistantRecord("a-3", "10:00:07.000", "msg_a", [{ type: "tool_use", id: "t-2", name: "Read", input: { file_path: "/x" } }]),
      { type: "user", uuid: "u-2", timestamp: "2026-07-04T10:00:08.000Z", sessionId: SESS, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t-1", content: "ok" }] } },
      // A second, distinct response.
      assistantRecord("a-4", "10:00:10.000", "msg_b", [{ type: "text", text: "done" }]),
    ]);

    expect(session.turns.length).toBe(2);
    expect(session.totals.turnCount).toBe(2);

    const [first, second] = session.turns;
    // Usage booked once, not three times.
    expect(first.usage).toMatchObject({ input: 100, output: 50, cacheRead: 1_000, cacheCreation: 200, total: 1_350 });
    // Tool calls from every record of msg_a merged into the one turn, in order.
    expect(first.toolCalls.map((c) => c.name)).toEqual(["Bash", "Read"]);
    expect(first.toolCalls[0].status).toBe("ok");
    expect(second.usage?.total).toBe(1_350);

    // Session totals: exactly two responses' worth of tokens.
    expect(session.totals.tokens.total).toBe(2_700);
    expect(session.totals.toolCallCount).toBe(2);
  });

  it("keeps id-less records unpriced and retains one coherent snapshot as unattributed tokens", async () => {
    const session = await loadFixture([
      { type: "assistant", uuid: "a-1", timestamp: "2026-07-04T10:00:00.000Z", sessionId: SESS, message: { role: "assistant", model: "claude-opus-4-8", content: [{ type: "text", text: "x" }], usage: USAGE } },
      { type: "assistant", uuid: "a-2", timestamp: "2026-07-04T10:00:01.000Z", sessionId: SESS, message: { role: "assistant", model: "claude-opus-4-8", content: [{ type: "text", text: "y" }], usage: USAGE } },
    ]);
    expect(session.turns.length).toBe(2);
    expect(session.turns.every((turn) => turn.usage === undefined)).toBe(true);
    expect(session.unattributedUsage).toMatchObject({ input: 100, output: 50, cacheRead: 1_000, cacheCreation: 200, total: 1_350 });
    expect(session.totals.tokens.total).toBe(1_350);
    expect((await buildReceiptModel(session)).totalUsd).toBeNull();
  });

  it.each([
    ["null", { ...USAGE, input_tokens: null }, 1_250],
    ["string", { ...USAGE, output_tokens: "50" }, 1_300],
    ["negative", { ...USAGE, cache_read_input_tokens: -1 }, 350],
    ["fractional", { ...USAGE, cache_creation_input_tokens: 1.5 }, 1_150],
    ["non-safe", { ...USAGE, input_tokens: Number.MAX_SAFE_INTEGER + 1 }, 1_250],
    ["malformed cache split", { ...USAGE, cache_creation: null }, 1_350],
  ] as const)("keeps valid components but suppresses dollars for %s Claude usage", async (_label, usage, safeTotal) => {
    const session = await loadFixture([
      assistantRecord("a-1", "10:00:00.000", "msg_malformed", [{ type: "text", text: "x" }], usage),
    ]);

    expect(session.turns[0].usage?.total).toBe(safeTotal);
    expect(session.turns[0].pricingUnits).toEqual([]);
    expect(session.droppedRecords).toBe(1);
    const receipt = await buildReceiptModel(session);
    expect(receipt.totalUsd).toBeNull();
    expect(receipt.caveats).toContainEqual(expect.objectContaining({ kind: "dropped-transcript-records" }));
  });

  it("fails closed when individually safe Claude counters overflow their total", async () => {
    const session = await loadFixture([
      assistantRecord(
        "a-1",
        "10:00:00.000",
        "msg_overflow",
        [{ type: "text", text: "x" }],
        {
          input_tokens: Number.MAX_SAFE_INTEGER,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      ),
    ]);

    expect(session.turns[0].usage).toEqual(expect.objectContaining({ total: 0 }));
    expect(session.turns[0].pricingUnits).toEqual([]);
    expect(session.droppedRecords).toBe(1);
    expect((await buildReceiptModel(session)).totalUsd).toBeNull();
  });

  it("never lets a malformed higher-output duplicate replace a coherent valid snapshot", async () => {
    const session = await loadFixture([
      assistantRecord("a-1", "10:00:00.000", "msg_coherent", [{ type: "text", text: "x" }], USAGE),
      assistantRecord(
        "a-2",
        "10:00:01.000",
        "msg_coherent",
        [{ type: "text", text: "y" }],
        { ...USAGE, input_tokens: null, output_tokens: 500 },
      ),
    ]);

    expect(session.turns[0].usage).toMatchObject({ input: 100, output: 50, total: 1_350 });
    expect(session.turns[0].pricingUnits).toBeUndefined();
    expect(session.droppedRecords).toBe(1);
    expect((await buildReceiptModel(session)).totalUsd).not.toBeNull();
  });

  it("attaches usage from a later record when the id's first record carried none", async () => {
    const session = await loadFixture([
      assistantRecord("a-1", "10:00:00.000", "msg_a", [{ type: "text", text: "thinking" }], null),
      assistantRecord("a-2", "10:00:01.000", "msg_a", [{ type: "tool_use", id: "t-1", name: "Bash", input: {} }]),
    ]);
    expect(session.turns.length).toBe(1);
    expect(session.turns[0].usage?.total).toBe(1_350);
    expect(session.turns[0].toolCalls.map((c) => c.name)).toEqual(["Bash"]);
  });

  it("retains the coherent snapshot with highest output across evolving duplicates", async () => {
    const session = await loadById("claude-code", EVOLVING_FIXTURE);
    expect(session).not.toBeNull();

    // msg_evolving is one observable response group despite four records. The
    // second record has the documented highest output; its other components
    // stay together rather than fabricating independent bucket maxima.
    expect(session!.turns[0].usage).toEqual({
      input: 90,
      output: 50,
      cacheRead: 900,
      cacheCreation: 180,
      cacheCreation5m: 120,
      cacheCreation1h: 60,
      total: 1_220,
    });
    expect(session!.turns[0].outputTokens).toBe(50);

    // tool-1 is repeated in a cumulative snapshot but remains one call; the
    // distinct tool-2 and both later results survive the merge.
    expect(session!.turns[0].toolCalls).toHaveLength(2);
    expect(session!.turns[0].toolCalls[0]).toMatchObject({
      name: "Bash",
      input: { command: "first" },
      output: "first result",
      status: "ok",
    });
    expect(session!.turns[0].toolCalls[1]).toMatchObject({
      name: "Read",
      output: "second result",
      status: "error",
    });

    // Records without an API message id cannot be grouped safely. Their two
    // identical snapshots contribute one tokens-only unattributed envelope.
    expect(session!.turns).toHaveLength(3);
    expect(session!.unattributedUsage).toMatchObject({ input: 7, output: 3, total: 10 });
    expect(session!.totals).toMatchObject({
      tokens: { input: 97, output: 53, cacheRead: 900, cacheCreation: 180, total: 1_230 },
      turnCount: 3,
      toolCallCount: 2,
    });
  });

  it("clears usage and tool-id merge state at a fork boundary", async () => {
    const session = await loadFixture([
      assistantRecord("pre", "09:00:00.000", "msg_reused", [
        { type: "tool_use", id: "tool-reused", name: "Bash", input: { command: "parent" } },
      ], { input_tokens: 1_000, output_tokens: 100 }),
      { type: "fork-context-ref", agentId: "fork-1", parentSessionId: SESS },
      assistantRecord("post-1", "10:00:00.000", "msg_reused", [
        { type: "tool_use", id: "tool-reused", name: "Bash", input: { command: "child" } },
      ], { input_tokens: 20, output_tokens: 5 }),
      assistantRecord("post-2", "10:00:01.000", "msg_reused", [
        { type: "tool_use", id: "tool-reused", name: "Bash", input: { command: "duplicate child" } },
      ], { input_tokens: 18, output_tokens: 10 }),
      {
        type: "user",
        uuid: "post-result",
        timestamp: "2026-07-04T10:00:02.000Z",
        sessionId: SESS,
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tool-reused", content: "child result" }],
        },
      },
    ]);

    expect(session.turns).toHaveLength(1);
    expect(session.turns[0].usage).toMatchObject({ input: 18, output: 10, total: 28 });
    expect(session.turns[0].toolCalls).toEqual([
      expect.objectContaining({ input: { command: "child" }, output: "child result", status: "ok" }),
    ]);
    expect(session.totals).toMatchObject({
      tokens: { input: 18, output: 10, total: 28 },
      turnCount: 1,
      toolCallCount: 1,
    });
  });
});
