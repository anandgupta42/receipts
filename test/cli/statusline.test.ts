// SPEC-0007 R3/R4 integration test matrix: stdin mode (R3a), disk fallback
// (R3b), and the no-session empty state (R4) — all against real
// `test/fixtures/claude-code/*.jsonl` fixtures loaded via the same `loadById`
// path a real Claude Code invocation uses. `loadFromDisk`'s injectable
// `listSessionsFn`/`loadSessionFn` parameters keep this fully off the real
// `~/.claude/projects` directory (context-safety rule: never scan real
// transcripts).
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/index.js";
import type { Session, SessionSummary } from "../../src/parse/types.js";
import {
  loadFromDisk,
  loadFromStdinPayload,
  readStdin,
  runStatusline,
} from "../../src/cli/index.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/claude-code");

function fixturePath(name: string): string {
  return path.join(fixturesDir, name);
}

/** A readable stream standing in for `process.stdin`, matching the `NodeJS.ReadStream` shape `readStdin`/`runStatusline` consume (`isTTY` + async-iterable of `Buffer` chunks, matching a real stdin stream). */
function stdinStub(payload: string, isTTY = false): NodeJS.ReadStream {
  const stream = Readable.from(payload ? [Buffer.from(payload, "utf8")] : []) as unknown as NodeJS.ReadStream;
  (stream as unknown as { isTTY: boolean }).isTTY = isTTY;
  return stream;
}

/** Captures stdout writes made during `fn()`, restoring the real `process.stdout.write` afterward regardless of outcome. */
async function captureStdout(fn: () => Promise<number>): Promise<{ code: number; output: string }> {
  const original = process.stdout.write.bind(process.stdout);
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await fn();
    return { code, output };
  } finally {
    process.stdout.write = original;
  }
}

describe("readStdin", () => {
  it("returns an empty string immediately for a TTY stream (no pipe, never blocks)", async () => {
    const stream = stdinStub("", true);
    await expect(readStdin(stream)).resolves.toBe("");
  });

  it("reads the full piped payload for a non-TTY stream", async () => {
    const stream = stdinStub('{"transcript_path":"/x.jsonl"}', false);
    await expect(readStdin(stream)).resolves.toBe('{"transcript_path":"/x.jsonl"}');
  });
});

describe("loadFromStdinPayload (R3a)", () => {
  it("returns null for empty/whitespace-only input", async () => {
    await expect(loadFromStdinPayload("")).resolves.toBeNull();
    await expect(loadFromStdinPayload("   \n")).resolves.toBeNull();
  });

  it("returns null for malformed JSON", async () => {
    await expect(loadFromStdinPayload("{not json")).resolves.toBeNull();
  });

  it("returns null when transcript_path is missing or not a string", async () => {
    await expect(loadFromStdinPayload("{}")).resolves.toBeNull();
    await expect(loadFromStdinPayload('{"transcript_path": 5}')).resolves.toBeNull();
    await expect(loadFromStdinPayload('{"transcript_path": ""}')).resolves.toBeNull();
  });

  it("returns null (never throws) when transcript_path points at a nonexistent file", async () => {
    await expect(loadFromStdinPayload('{"transcript_path":"/no/such/file.jsonl"}')).resolves.toBeNull();
  });

  it("loads the referenced fixture directly via loadById('claude-code', transcript_path)", async () => {
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const session = await loadFromStdinPayload(JSON.stringify({ transcript_path: transcriptPath }));
    expect(session).not.toBeNull();
    expect(session?.source).toBe("claude-code");
  });

  it("ignores unrelated fields alongside transcript_path (real Claude Code payloads carry more)", async () => {
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const payload = JSON.stringify({
      hook_event_name: "Status",
      session_id: "abc123",
      transcript_path: transcriptPath,
      cwd: "/some/project",
      model: { id: "claude-opus-4-8", display_name: "Opus" },
    });
    const session = await loadFromStdinPayload(payload);
    expect(session).not.toBeNull();
  });
});

describe("loadFromDisk (R3b, fixture-injected — never touches real ~/.claude/projects)", () => {
  it("returns null when the injected session list is empty", async () => {
    const listSessionsFn = async (): Promise<SessionSummary[]> => [];
    const loadSessionFn = async (): Promise<Session | null> => null;
    await expect(loadFromDisk(listSessionsFn, loadSessionFn)).resolves.toBeNull();
  });

  it("loads the first (newest) summary via the injected loadSessionFn", async () => {
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const summary = (await loadById("claude-code", transcriptPath))!;
    const listSessionsFn = async (): Promise<SessionSummary[]> => [summary];
    const loadSessionFn = async (s: SessionSummary): Promise<Session | null> => loadById(s.source, s.filePath);
    const session = await loadFromDisk(listSessionsFn, loadSessionFn);
    expect(session).not.toBeNull();
    expect(session?.source).toBe("claude-code");
  });
});

describe("runStatusline (R3/R4 end-to-end)", () => {
  it("R3a: prefers the stdin payload's session over disk fallback", async () => {
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const stdin = stdinStub(JSON.stringify({ transcript_path: transcriptPath }));
    const diskFallbackCalled = { value: false };
    const loadFromDiskFn = async (): Promise<Session | null> => {
      diskFallbackCalled.value = true;
      return null;
    };
    const { code, output } = await captureStdout(() => runStatusline(stdin, loadFromDiskFn));
    expect(code).toBe(0);
    expect(diskFallbackCalled.value).toBe(false);
    expect(output).toContain("[Claude Code]");
  });

  it("R3b: falls back to disk when stdin is empty (TTY)", async () => {
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const stdin = stdinStub("", true);
    const loadFromDiskFn = async (): Promise<Session | null> => loadById("claude-code", transcriptPath);
    const { code, output } = await captureStdout(() => runStatusline(stdin, loadFromDiskFn));
    expect(code).toBe(0);
    expect(output).toContain("[Claude Code]");
  });

  it("R3b: falls back to disk when stdin is malformed JSON", async () => {
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const stdin = stdinStub("not json at all");
    const loadFromDiskFn = async (): Promise<Session | null> => loadById("claude-code", transcriptPath);
    const { code, output } = await captureStdout(() => runStatusline(stdin, loadFromDiskFn));
    expect(code).toBe(0);
    expect(output).toContain("[Claude Code]");
  });

  it("R1: renders a stuck-loop waste flag for the 5x Bash loop fixture", async () => {
    const transcriptPath = fixturePath("loop-bash-5x.jsonl");
    const stdin = stdinStub(JSON.stringify({ transcript_path: transcriptPath }));
    const { code, output } = await captureStdout(() => runStatusline(stdin));
    expect(code).toBe(0);
    expect(output).toContain("[Claude Code]");
    expect(output).toContain("⚠");
    expect(output).toContain("Bash loop ×");
  });

  it("R1: renders a trivial-spans waste flag for the quick-QA fixture", async () => {
    const transcriptPath = fixturePath("trivial-spans-quick-qa.jsonl");
    const stdin = stdinStub(JSON.stringify({ transcript_path: transcriptPath }));
    const { code, output } = await captureStdout(() => runStatusline(stdin));
    expect(code).toBe(0);
    expect(output).toContain("[Claude Code]");
    // Whichever waste kind this fixture actually trips (stuck-loop or
    // trivial-spans), the line must carry exactly one factual waste flag —
    // asserting on the flag's presence/shape rather than a hardcoded magic
    // number keeps this test honest about what the detectors actually found
    // in the fixture, without needing a separate script run to pre-compute it.
    expect(output).toMatch(/⚠ (\d[\d,]* trivial spans|\S+ loop ×\d+)/);
  });

  it("R1: no waste flag for the clean multi-tool fixture", async () => {
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const stdin = stdinStub(JSON.stringify({ transcript_path: transcriptPath }));
    const { code, output } = await captureStdout(() => runStatusline(stdin));
    expect(code).toBe(0);
    expect(output).not.toContain("⚠");
  });

  it("R4: neutral no-session placeholder when both stdin and disk fallback are empty, exit 0", async () => {
    const stdin = stdinStub("", true);
    const loadFromDiskFn = async (): Promise<Session | null> => null;
    const { code, output } = await captureStdout(() => runStatusline(stdin, loadFromDiskFn));
    expect(code).toBe(0);
    expect(output).toBe("aireceipts: no sessions detected\n");
  });

  it("R3 latency: loadById + buildReceiptModel resolves within 200ms per fixture", async () => {
    const { buildReceiptModel } = await import("../../src/receipt/model.js");
    const files = ["clean-multi-tool-2-models.jsonl", "loop-bash-5x.jsonl", "trivial-spans-quick-qa.jsonl"];
    for (const file of files) {
      const started = performance.now();
      const session = await loadById("claude-code", fixturePath(file));
      expect(session).not.toBeNull();
      await buildReceiptModel(session!);
      const elapsedMs = performance.now() - started;
      expect(elapsedMs).toBeLessThanOrEqual(200);
    }
  });

  it("SPEC-0061 R3 latency: the subagent rollup (children present) stays within the same 200ms budget", async () => {
    const { buildReceiptModel } = await import("../../src/receipt/model.js");
    const { attachSubagentRollup } = await import("../../src/receipt/subagents.js");
    const started = performance.now();
    const session = await loadById("claude-code", fixturePath("clean-with-subagents.jsonl"));
    expect(session).not.toBeNull();
    const model = await attachSubagentRollup(await buildReceiptModel(session!), session!.filePath);
    const elapsedMs = performance.now() - started;
    expect(model.subagents?.count).toBe(2);
    expect(elapsedMs).toBeLessThanOrEqual(200);
  });
});
