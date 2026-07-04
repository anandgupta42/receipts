// SPEC-0038 R4 — the fork boundary cuts at the adapter. A fork transcript's
// `fork-context-ref` marker separates inherited parent history from the fork's
// own work; everything before it must not exist downstream (anchors, pricing,
// rollup all see post-fork turns only). Fixtures are synthesized per-test so
// the boundary can be shifted one record each way (matrix rows).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadById } from "../../src/parse/load.js";

const SESS = "aaaaaaaa-1111-2222-3333-444444444444";
const INHERITED_SHA = "beefcaf" + "e".repeat(33);
const OWN_SHA = "1234abc" + "d".repeat(33);

type Rec = Record<string, unknown>;

function user(uuid: string, ts: string, text: string): Rec {
  return { type: "user", uuid, parentUuid: null, isSidechain: false, timestamp: `2026-07-04T${ts}Z`, sessionId: SESS, cwd: "/home/dev/repo", message: { role: "user", content: text } };
}

function commitTurn(uuid: string, ts: string, sha: string, tokens: number): Rec[] {
  return [
    {
      type: "assistant", uuid, parentUuid: null, isSidechain: false, timestamp: `2026-07-04T${ts}Z`, sessionId: SESS, cwd: "/home/dev/repo",
      message: {
        id: `msg_${uuid}`, type: "message", role: "assistant", model: "claude-opus-4-8",
        content: [{ type: "tool_use", id: `t-${uuid}`, name: "Bash", input: { command: "git commit -m x" } }],
        usage: { input_tokens: tokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 },
      },
    },
    { type: "user", uuid: `r-${uuid}`, parentUuid: uuid, isSidechain: false, timestamp: `2026-07-04T${ts}Z`, sessionId: SESS, cwd: "/home/dev/repo", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `t-${uuid}`, content: `[feat ${sha.slice(0, 7)}] x` }] } },
  ];
}

const MARKER: Rec = { type: "fork-context-ref", agentId: "f1", parentSessionId: SESS, parentLastUuid: "a-x", contextLength: 999 };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aireceipts-fork-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function loadRecords(name: string, records: Rec[]) {
  const fp = path.join(tmp, `${name}.jsonl`);
  fs.writeFileSync(fp, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return loadById("claude-code", fp);
}

const inherited = [user("u-inh", "09:00:00.000", "inherited prompt"), ...commitTurn("a-inh", "09:01:00.000", INHERITED_SHA, 5000)];
const own = [user("u-own", "10:00:00.000", "fork prompt"), ...commitTurn("a-own", "10:01:00.000", OWN_SHA, 700)];

describe("SPEC-0038 R4 · fork boundary at the adapter", () => {
  it("records before the marker are cut: turns, usage, and anchors are post-fork only", async () => {
    const session = (await loadRecords("boundary", [...inherited, MARKER, ...own]))!;
    expect(session).not.toBeNull();
    expect(session.totals.tokens.input).toBe(700); // inherited 5000 gone
    const outputs = session.turns.flatMap((t) => t.toolCalls).map((c) => String(c.output ?? ""));
    expect(outputs.join("\n")).toContain(OWN_SHA.slice(0, 7));
    expect(outputs.join("\n")).not.toContain(INHERITED_SHA.slice(0, 7));
    expect(session.startedAt).toBe(Date.parse("2026-07-04T10:00:00.000Z")); // not the inherited 09:00
  });

  it("boundary one record EARLIER: nothing BEFORE the marker ever survives (the guarantee); post-marker records are the file's own claim", async () => {
    // The marker is ground truth (S5 finding 4 disposition, spec Validation):
    // the adapter cannot content-identify "inherited" records — its guarantee
    // is that NOTHING pre-marker is admitted. Real fork files carry the marker
    // first; a mid-file marker only ever CUTS more, never admits more.
    const [inhUser, inhAsst, inhResult] = inherited;
    const session = (await loadRecords("early", [inhUser, MARKER, inhAsst, inhResult, ...own]))!;
    expect(session.totals.tokens.input).toBe(5700); // both post-marker turns priced
    expect(session.turns.flatMap((t) => t.toolCalls).length).toBe(2);
    // the pre-marker user record contributed nothing (no usage, no turn, no title)
    expect(session.startedAt).toBe(Date.parse("2026-07-04T09:01:00.000Z"));
  });

  it("boundary one record LATER (marker after the fork's first record) keeps the fork's own commit", async () => {
    const [ownUser, ...ownRest] = own;
    const session = (await loadRecords("late", [...inherited, ownUser, MARKER, ...ownRest]))!;
    // ownUser fell before the marker and is cut; the commit itself survives.
    const outputs = session.turns.flatMap((t) => t.toolCalls).map((c) => String(c.output ?? ""));
    expect(outputs.join("\n")).toContain(OWN_SHA.slice(0, 7));
    expect(session.totals.tokens.input).toBe(700);
  });

  it("a file with no marker parses exactly as before (non-fork transcripts untouched)", async () => {
    const session = (await loadRecords("plain", [...inherited, ...own]))!;
    expect(session.totals.tokens.input).toBe(5700);
    expect(session.turns.flatMap((t) => t.toolCalls).length).toBe(2);
  });
});
