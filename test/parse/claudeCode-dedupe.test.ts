// One billed API response = one turn. Claude Code writes one `assistant`
// record per content block, and every record of the same response repeats the
// same `message.id` and the same `usage` snapshot (audited 2026-07-08 over 19
// real transcripts: up to 12 records per id, usage byte-identical). Counting
// per record multiplied session cost ~2.8× — the PR #189 receipt claimed
// $5.17 for a slice whose deduped cost is $1.61. These tests pin the fix:
// turns and usage are keyed by message id; tool_use blocks from every record
// of the id merge into that one turn.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadById } from "../../src/parse/load.js";

const SESS = "dddddddd-1111-2222-3333-555555555555";

type Rec = Record<string, unknown>;

const USAGE = {
  input_tokens: 100,
  output_tokens: 50,
  cache_read_input_tokens: 1_000,
  cache_creation_input_tokens: 200,
};

/** `usage: null` omits the field entirely (a usage-less record). */
function assistantRecord(uuid: string, ts: string, messageId: string, content: unknown[], usage: Record<string, number> | null = USAGE): Rec {
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

describe("claude-code adapter: one billed response = one turn (message-id dedupe)", () => {
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

  it("keeps records without a message id as separate turns (nothing to match on)", async () => {
    const session = await loadFixture([
      { type: "assistant", uuid: "a-1", timestamp: "2026-07-04T10:00:00.000Z", sessionId: SESS, message: { role: "assistant", model: "claude-opus-4-8", content: [{ type: "text", text: "x" }], usage: USAGE } },
      { type: "assistant", uuid: "a-2", timestamp: "2026-07-04T10:00:01.000Z", sessionId: SESS, message: { role: "assistant", model: "claude-opus-4-8", content: [{ type: "text", text: "y" }], usage: USAGE } },
    ]);
    expect(session.turns.length).toBe(2);
    expect(session.totals.tokens.total).toBe(2_700);
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
});
