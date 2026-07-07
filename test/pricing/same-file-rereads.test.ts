// SPEC-0068 — unit tests for detectSameFileReReads. Real data/prices (haiku
// input rate = 1.0/token-million, so a 1-call read turn with input=1e6 = $1).
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectSameFileReReads } from "../../src/pricing/waste.js";
import type { Session, SessionTotals, TokenUsage, ToolCall, Turn } from "../../src/parse/types.js";

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/prices");
const JUNE_15_2026 = Date.UTC(2026, 5, 15, 10, 0, 0);
const HAIKU = "claude-haiku-4-5";

function usage(input: number): TokenUsage {
  return { total: input, input, output: 0, cacheRead: 0, cacheCreation: 0 };
}
function session(turns: Turn[], overrides: Partial<Session> = {}): Session {
  const totals: SessionTotals = { tokens: usage(0), turnCount: 0, toolCallCount: 0 };
  return { id: "s", source: "claude-code", filePath: "/f.jsonl", totals, turns, ...overrides };
}
function turn(index: number, calls: ToolCall[], model: string | undefined = HAIKU): Turn {
  return { index, timestamp: JUNE_15_2026, model, usage: usage(1_000_000), toolCalls: calls };
}
const read = (fp: string, status?: "ok" | "error"): ToolCall => ({ name: "Read", input: { file_path: fp }, ...(status ? { status } : {}) });
const edit = (fp: string): ToolCall => ({ name: "Edit", input: { file_path: fp } });
const bash = (command: string): ToolCall => ({ name: "Bash", shell: true, input: { command } });

describe("detectSameFileReReads", () => {
  it("counts same-file re-reads with nothing recorded between", async () => {
    const s = session([turn(0, [read("a.ts")]), turn(1, [read("a.ts")]), turn(2, [read("a.ts")])]);
    const f = await detectSameFileReReads(s, dataDir);
    expect(f?.count).toBe(2);
    expect(f?.confidence).toBe("low");
    expect(f?.usd).toBeCloseTo(2, 10);
  });

  it("does not count a re-read after an Edit to that file", async () => {
    const s = session([turn(0, [read("a.ts")]), turn(1, [edit("a.ts")]), turn(2, [read("a.ts")])]);
    expect(await detectSameFileReReads(s, dataDir)).toBeNull();
  });

  it("does not count a re-read after a shell command naming the file", async () => {
    const s = session([turn(0, [read("a.ts")]), turn(1, [bash("sed -i s/x/y/ a.ts")]), turn(2, [read("a.ts")])]);
    expect(await detectSameFileReReads(s, dataDir)).toBeNull();
  });

  it("does not count a re-read after a whole-tree shell mutator", async () => {
    const s = session([turn(0, [read("a.ts")]), turn(1, [bash("git checkout .")]), turn(2, [read("a.ts")])]);
    expect(await detectSameFileReReads(s, dataDir)).toBeNull();
  });

  it("does not count a re-read across a compaction", async () => {
    const s = session([turn(0, [read("a.ts")]), turn(2, [read("a.ts")])], { compactions: [{ turnIndex: 1 }] });
    expect(await detectSameFileReReads(s, dataDir)).toBeNull();
  });

  it("treats different directories as different files", async () => {
    const s = session([turn(0, [read("src/a.ts")]), turn(1, [read("test/a.ts")])]);
    expect(await detectSameFileReReads(s, dataDir)).toBeNull();
  });

  it("treats a failed read then a successful read as a retry, not a re-read", async () => {
    const s = session([turn(0, [read("a.ts", "error")]), turn(1, [read("a.ts", "ok")])]);
    expect(await detectSameFileReReads(s, dataDir)).toBeNull();
  });

  it("resolves path aliases (./a.ts and a.ts are the same file)", async () => {
    const s = session([turn(0, [read("./a.ts")]), turn(1, [read("a.ts")])]);
    expect((await detectSameFileReReads(s, dataDir))?.count).toBe(1);
  });

  it("keeps usd null when a counted re-read is unpriced (I2)", async () => {
    const s = session([turn(0, [read("a.ts")]), turn(1, [read("a.ts")])], { unpriceable: true });
    const f = await detectSameFileReReads(s, dataDir);
    expect(f?.count).toBe(1);
    expect(f?.usd).toBeNull();
  });

  it("excludes a re-read after a shell command naming a multi-dot basename (Codex #1)", async () => {
    const s = session([turn(0, [read("schema.test.ts")]), turn(1, [bash("sed -i s/x/y/ schema.test.ts")]), turn(2, [read("schema.test.ts")])]);
    expect(await detectSameFileReReads(s, dataDir)).toBeNull();
  });

  it("excludes a re-read after a shell command naming a no-extension file (Codex #1)", async () => {
    const s = session([turn(0, [read("Makefile")]), turn(1, [bash("touch Makefile")]), turn(2, [read("Makefile")])]);
    expect(await detectSameFileReReads(s, dataDir)).toBeNull();
  });

  it("does NOT treat a path-specific git checkout as whole-tree (Codex #2)", async () => {
    // git checkout of an UNRELATED file must not suppress a.ts re-reads.
    const s = session([turn(0, [read("a.ts")]), turn(1, [bash("git checkout README.md")]), turn(2, [read("a.ts")])]);
    expect((await detectSameFileReReads(s, dataDir))?.count).toBe(1);
  });

  it("treats `prettier . --write` as a whole-tree mutator (Codex #2)", async () => {
    const s = session([turn(0, [read("a.ts")]), turn(1, [bash("prettier . --write")]), turn(2, [read("a.ts")])]);
    expect(await detectSameFileReReads(s, dataDir)).toBeNull();
  });

  it("never fires without a Read tool (non-Claude shape)", async () => {
    const s = session([turn(0, [bash("cat a.ts")]), turn(1, [bash("cat a.ts")])]);
    expect(await detectSameFileReReads(s, dataDir)).toBeNull();
  });
});
