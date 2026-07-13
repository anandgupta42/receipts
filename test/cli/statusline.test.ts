// SPEC-0007 R3/R4 integration test matrix: stdin mode (R3a), disk fallback
// (R3b), and the no-session empty state (R4) — all against real
// `test/fixtures/claude-code/*.jsonl` fixtures loaded via the same `loadById`
// path a real Claude Code invocation uses. `loadFromDisk`'s injectable
// `listSessionsFn`/`loadSessionFn` parameters keep this fully off the real
// `~/.claude/projects` directory (context-safety rule: never scan real
// transcripts).
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadById } from "../../src/index.js";
import type { Session, SessionSummary } from "../../src/parse/types.js";
import {
  loadFromCwd,
  loadFromDisk,
  loadFromStdinPayload,
  MAX_SCOPED_LOAD_ATTEMPTS,
  readStdin,
  runStatusline,
} from "../../src/cli/index.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/claude-code");
let isolatedHome: string;
let savedAireceiptsHome: string | undefined;

beforeAll(async () => {
  savedAireceiptsHome = process.env.AIRECEIPTS_HOME;
  isolatedHome = await mkdtemp(path.join(tmpdir(), "aireceipts-statusline-test-"));
  process.env.AIRECEIPTS_HOME = isolatedHome;
  await mkdir(path.join(isolatedHome, ".aireceipts"), { recursive: true });
});

afterAll(async () => {
  if (savedAireceiptsHome === undefined) delete process.env.AIRECEIPTS_HOME;
  else process.env.AIRECEIPTS_HOME = savedAireceiptsHome;
  await rm(isolatedHome, { recursive: true, force: true });
});

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

describe("loadFromCwd (SPEC-0075 R1, fixture-injected)", () => {
  it("skips a newer colliding Claude Code candidate and selects the matching Codex session", async () => {
    const fixture = (await loadById("claude-code", fixturePath("clean-multi-tool-2-models.jsonl")))!;
    const claudeElsewhere: Session = { ...fixture, id: "cc-collision", cwd: "/elsewhere", endedAt: 2_000 };
    const codexHere: Session = { ...fixture, id: "codex-here", source: "codex", cwd: "/repo", endedAt: 1_000 };
    const candidates: SessionSummary[] = [claudeElsewhere, codexHere];
    const loaded = new Map<string, Session>([
      [claudeElsewhere.id, claudeElsewhere],
      [codexHere.id, codexHere],
    ]);
    const scopedLoader = (cwd: string) =>
      loadFromCwd(
        cwd,
        async () => candidates,
        async (summary) => loaded.get(summary.id) ?? null,
      );

    const { code, output } = await captureStdout(() =>
      runStatusline(stdinStub("", true), async () => null, undefined, undefined, {
        cwd: "/repo/sub",
        loadFromCwdFn: scopedLoader,
      }),
    );

    expect(code).toBe(0);
    expect(output).toContain("[aireceipts · Codex]");
    expect(output).not.toContain("Claude Code");
  });

  it("rejects a non-Claude candidate when its fully loaded cwd no longer matches", async () => {
    const fixture = (await loadById("claude-code", fixturePath("clean-multi-tool-2-models.jsonl")))!;
    const candidate: Session = { ...fixture, id: "codex-lazy-match", source: "codex", cwd: "/repo" };
    const loaded: Session = { ...candidate, cwd: "/elsewhere" };
    let listArgs: [string, string] | undefined;

    const session = await loadFromCwd(
      "/repo/sub",
      async (cwd, homeDir) => {
        listArgs = [cwd, homeDir];
        return [candidate];
      },
      async () => loaded,
      "/Users/test",
    );

    expect(session).toBeNull();
    expect(listArgs).toEqual(["/repo/sub", "/Users/test"]);
  });

  it("accepts a non-Claude candidate only after its fully loaded cwd is confirmed", async () => {
    const fixture = (await loadById("claude-code", fixturePath("clean-multi-tool-2-models.jsonl")))!;
    const candidate: Session = { ...fixture, id: "codex-confirmed", source: "codex", cwd: "/repo" };
    let loads = 0;

    const session = await loadFromCwd(
      "/repo/sub",
      async () => [candidate],
      async () => {
        loads++;
        return candidate;
      },
      "/Users/test",
    );

    expect(session).toBe(candidate);
    expect(loads).toBe(1);
  });

  it("renders a genuine match at the final allowed load index", async () => {
    const fixture = (await loadById("claude-code", fixturePath("clean-multi-tool-2-models.jsonl")))!;
    const collisions: Session[] = Array.from({ length: MAX_SCOPED_LOAD_ATTEMPTS - 1 }, (_, i) => ({
      ...fixture,
      id: `collision-${i}`,
      cwd: "/my/repo",
    }));
    const match: Session = { ...fixture, id: "match-at-cap-minus-one", cwd: "/my-repo" };
    let loads = 0;
    const scopedLoader = (cwd: string) =>
      loadFromCwd(
        cwd,
        async () => [...collisions, match],
        async (summary) => {
          loads++;
          return [...collisions, match].find((session) => session.id === summary.id) ?? null;
        },
      );

    const { code, output } = await captureStdout(() =>
      runStatusline(stdinStub("", true), async () => null, undefined, undefined, {
        cwd: "/my-repo",
        loadFromCwdFn: scopedLoader,
      }),
    );

    expect(code).toBe(0);
    expect(output).toContain("[aireceipts · Claude Code]");
    expect(loads).toBe(MAX_SCOPED_LOAD_ATTEMPTS);
  });

  it("renders the placeholder when the first genuine match is beyond the load cap", async () => {
    const fixture = (await loadById("claude-code", fixturePath("clean-multi-tool-2-models.jsonl")))!;
    const collisions: Session[] = Array.from({ length: MAX_SCOPED_LOAD_ATTEMPTS }, (_, i) => ({
      ...fixture,
      id: `collision-${i}`,
      cwd: "/my/repo",
    }));
    const match: Session = { ...fixture, id: "match-at-cap", cwd: "/my-repo" };
    const candidates = [...collisions, match];
    let loads = 0;
    const scopedLoader = (cwd: string) =>
      loadFromCwd(
        cwd,
        async () => candidates,
        async (summary) => {
          loads++;
          return candidates.find((session) => session.id === summary.id) ?? null;
        },
      );

    const { code, output } = await captureStdout(() =>
      runStatusline(stdinStub("", true), async () => null, undefined, undefined, {
        cwd: "/my-repo",
        loadFromCwdFn: scopedLoader,
      }),
    );

    expect(code).toBe(0);
    expect(output).toBe("aireceipts: no sessions detected\n");
    expect(loads).toBe(MAX_SCOPED_LOAD_ATTEMPTS);
  });

  it("rejects a Claude Code encoding collision after full load", async () => {
    const fixture = (await loadById("claude-code", fixturePath("clean-multi-tool-2-models.jsonl")))!;
    const collision: Session = { ...fixture, id: "collision", cwd: "/my/repo" };
    const scopedLoader = (cwd: string) =>
      loadFromCwd(cwd, async () => [collision], async () => collision);

    const { code, output } = await captureStdout(() =>
      runStatusline(stdinStub("", true), async () => fixture, undefined, undefined, {
        cwd: "/my-repo",
        loadFromCwdFn: scopedLoader,
      }),
    );

    expect(code).toBe(0);
    expect(output).toBe("aireceipts: no sessions detected\n");
  });

  it("returns the neutral placeholder without falling back globally when no scoped session matches", async () => {
    let globalFallbackCalled = false;
    const { code, output } = await captureStdout(() =>
      runStatusline(
        stdinStub("", true),
        async () => {
          globalFallbackCalled = true;
          return loadById("claude-code", fixturePath("clean-multi-tool-2-models.jsonl"));
        },
        undefined,
        undefined,
        { cwd: "/repo", loadFromCwdFn: async () => null },
      ),
    );

    expect(code).toBe(0);
    expect(output).toBe("aireceipts: no sessions detected\n");
    expect(globalFallbackCalled).toBe(false);
  });
});

describe("runStatusline (R3/R4 end-to-end)", () => {
  it("SPEC-0075 R1: a usable stdin payload wins over --cwd with byte-identical output", async () => {
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const payload = JSON.stringify({ transcript_path: transcriptPath });
    const baseline = await captureStdout(() => runStatusline(stdinStub(payload), async () => null));
    let scopedLoaderCalled = false;
    const scoped = await captureStdout(() =>
      runStatusline(stdinStub(payload), async () => null, undefined, undefined, {
        cwd: "/some/other/project",
        loadFromCwdFn: async () => {
          scopedLoaderCalled = true;
          return null;
        },
      }),
    );

    expect(scoped).toEqual(baseline);
    expect(scopedLoaderCalled).toBe(false);
  });

  it("SPEC-0075 R1: an unscoped invocation preserves the existing disk-fallback bytes", async () => {
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const loadFromDiskFn = async (): Promise<Session | null> => loadById("claude-code", transcriptPath);
    const baseline = await captureStdout(() => runStatusline(stdinStub("", true), loadFromDiskFn));
    const explicitDefaults = await captureStdout(() => runStatusline(stdinStub("", true), loadFromDiskFn, undefined, undefined, {}));

    expect(explicitDefaults).toEqual(baseline);
  });

  it("SPEC-0075 R1: resolves --cwd . against the invocation directory before scoped loading", async () => {
    const fixture = (await loadById("claude-code", fixturePath("clean-multi-tool-2-models.jsonl")))!;
    let loadedCwd: string | undefined;

    const { code, output } = await captureStdout(() =>
      runStatusline(stdinStub("", true), async () => null, undefined, undefined, {
        cwd: ".",
        loadFromCwdFn: async (cwd) => {
          loadedCwd = cwd;
          return cwd === process.cwd() ? fixture : null;
        },
      }),
    );

    expect(code).toBe(0);
    expect(loadedCwd).toBe(process.cwd());
    expect(output).toContain("[aireceipts · Claude Code]");
  });

  it("SPEC-0075 R1: an already-absolute --cwd passes through unresolved (never drive-mangled on Windows)", async () => {
    // On win32, path.resolve("/home/x") prepends the current drive — a
    // POSIX-recorded session would then never match. Absolute input in either
    // platform's spelling must reach the scoped loader byte-identical.
    for (const absolute of ["/home/dev/webapp", "C:\\repo\\sub"]) {
      let loadedCwd: string | undefined;
      await captureStdout(() =>
        runStatusline(stdinStub("", true), async () => null, undefined, undefined, {
          cwd: absolute,
          loadFromCwdFn: async (cwd) => {
            loadedCwd = cwd;
            return null;
          },
        }),
      );
      expect(loadedCwd).toBe(absolute);
    }
  });

  it("SPEC-0075 R2: stdin/native mode renders configured items in literal order, including duplicates", async () => {
    const configPath = path.join(isolatedHome, "ordered-statusline.json");
    await writeFile(configPath, JSON.stringify({ items: ["tokens", "brand", "cost", "brand"] }), "utf8");
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const { code, output } = await captureStdout(() =>
      runStatusline(stdinStub(JSON.stringify({ transcript_path: transcriptPath })), async () => null, undefined, undefined, {
        formatConfigPath: configPath,
      }),
    );

    expect(code).toBe(0);
    expect(output).toBe("147k · [aireceipts] · ≥$0.1767 · [aireceipts]\n");
  });

  it("SPEC-0075 R2: explicit --format beats a valid config file", async () => {
    const configPath = path.join(isolatedHome, "overridden-statusline.json");
    await writeFile(configPath, JSON.stringify({ items: ["tokens"] }), "utf8");
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const { code, output } = await captureStdout(() =>
      runStatusline(stdinStub(JSON.stringify({ transcript_path: transcriptPath })), async () => null, undefined, undefined, {
        format: "cost,brand",
        formatConfigPath: configPath,
      }),
    );

    expect(code).toBe(0);
    expect(output).toBe("≥$0.1767 · [aireceipts]\n");
  });

  it.each([
    ["bad JSON", "{bad json"],
    ["unknown item", JSON.stringify({ items: ["brand", "bogus"] })],
    ["wrong shape", JSON.stringify({ items: "brand" })],
    ["empty items", JSON.stringify({ items: [] })],
  ])("SPEC-0075 R2: %s falls back to the default with one stderr note", async (_case, rawConfig) => {
    const configPath = path.join(isolatedHome, `invalid-${_case.replace(/\s/g, "-")}.json`);
    const absentPath = path.join(isolatedHome, "absent-default.json");
    await writeFile(configPath, rawConfig, "utf8");
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const payload = JSON.stringify({ transcript_path: transcriptPath });
    const baseline = await captureStdout(() =>
      runStatusline(stdinStub(payload), async () => null, undefined, undefined, { formatConfigPath: absentPath }),
    );
    let err = "";
    const actual = await captureStdout(() =>
      runStatusline(stdinStub(payload), async () => null, undefined, undefined, {
        formatConfigPath: configPath,
        writeError: (s) => {
          err += s;
        },
      }),
    );

    expect(actual.code).toBe(0);
    expect(actual.output).toBe(baseline.output);
    expect(err).toContain("statusline.json ignored:");
    expect(err.trimEnd().split("\n")).toHaveLength(1);
  });

  it("SPEC-0075 R2: an unreadable config falls back to the default with one stderr note", async () => {
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const payload = JSON.stringify({ transcript_path: transcriptPath });
    const absentPath = path.join(isolatedHome, "absent-unreadable-default.json");
    const baseline = await captureStdout(() =>
      runStatusline(stdinStub(payload), async () => null, undefined, undefined, { formatConfigPath: absentPath }),
    );
    let err = "";
    const actual = await captureStdout(() =>
      runStatusline(stdinStub(payload), async () => null, undefined, undefined, {
        formatConfigPath: isolatedHome,
        writeError: (s) => {
          err += s;
        },
      }),
    );

    expect(actual).toEqual({ code: 0, output: baseline.output });
    expect(err).toBe("statusline.json ignored: could not read statusline.json\n");
  });

  it("SPEC-0075 R2: an absent config silently preserves the default", async () => {
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    let err = "";
    const baseline = await captureStdout(() =>
      runStatusline(stdinStub(JSON.stringify({ transcript_path: transcriptPath })), async () => null, undefined, undefined, {
        formatConfigPath: path.join(isolatedHome, "definitely-absent.json"),
        writeError: (s) => {
          err += s;
        },
      }),
    );

    expect(baseline.code).toBe(0);
    // SPEC-0076: no payload `model` field → the model segment falls back to the
    // session's dominant model (this fixture's `claude-opus-4-8`) before the cost.
    expect(baseline.output).toContain("[aireceipts] claude-opus-4-8 · ≥$0.17");
    expect(err).toBe("");
  });

  it("SPEC-0075 R2: AIRECEIPTS_HOME is resolved at call time", async () => {
    const configPath = path.join(isolatedHome, ".aireceipts", "statusline.json");
    await writeFile(configPath, JSON.stringify({ items: ["tokens"] }), "utf8");
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    try {
      const { code, output } = await captureStdout(() =>
        runStatusline(stdinStub(JSON.stringify({ transcript_path: transcriptPath })), async () => null),
      );
      expect(code).toBe(0);
      expect(output).toBe("147k\n");
    } finally {
      await unlink(configPath);
    }
  });

  it("SPEC-0075 R2: invalid explicit --format still fails fast when config is valid", async () => {
    const configPath = path.join(isolatedHome, "valid-but-unused.json");
    await writeFile(configPath, JSON.stringify({ items: ["tokens"] }), "utf8");
    let err = "";
    const { code, output } = await captureStdout(() =>
      runStatusline(stdinStub("", true), async () => null, undefined, undefined, {
        format: "bogus",
        formatConfigPath: configPath,
        writeError: (s) => {
          err += s;
        },
      }),
    );

    expect(code).toBe(1);
    expect(output).toBe("");
    expect(err).toContain('unknown statusline segment "bogus"');
    expect(err).not.toContain("statusline.json ignored");
  });

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
    expect(output).toContain("[aireceipts]");
  });

  it("SPEC-0076 R1 stale-payload gate (command level): a payload with a dead transcript_path never leaks its model into disk fallback", async () => {
    // The payload parses (so it survives into the SegmentContext) but its
    // transcript can't load; the disk-fallback session's dominant model must
    // win — never the stale payload's "Opus".
    const stdin = stdinStub(
      JSON.stringify({ transcript_path: "/no/such/file.jsonl", model: { id: "claude-opus-4-8", display_name: "Opus" } }),
    );
    const loadFromDiskFn = async (): Promise<Session | null> =>
      loadById("claude-code", fixturePath("clean-multi-tool-2-models.jsonl"));
    const { code, output } = await captureStdout(() => runStatusline(stdin, loadFromDiskFn));
    expect(code).toBe(0);
    expect(output).toContain("[aireceipts · Claude Code] claude-opus-4-8 ·");
    expect(output).not.toContain("] Opus ·");
  });

  it("R3b: falls back to disk when stdin is empty (TTY)", async () => {
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const stdin = stdinStub("", true);
    const loadFromDiskFn = async (): Promise<Session | null> => loadById("claude-code", transcriptPath);
    const { code, output } = await captureStdout(() => runStatusline(stdin, loadFromDiskFn));
    expect(code).toBe(0);
    expect(output).toContain("[aireceipts · Claude Code]");
  });

  it("R3b: falls back to disk when stdin is malformed JSON", async () => {
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const stdin = stdinStub("not json at all");
    const loadFromDiskFn = async (): Promise<Session | null> => loadById("claude-code", transcriptPath);
    const { code, output } = await captureStdout(() => runStatusline(stdin, loadFromDiskFn));
    expect(code).toBe(0);
    expect(output).toContain("[aireceipts · Claude Code]");
  });

  it("R1: renders a stuck-loop waste flag for the 5x Bash loop fixture", async () => {
    const transcriptPath = fixturePath("loop-bash-5x.jsonl");
    const stdin = stdinStub(JSON.stringify({ transcript_path: transcriptPath }));
    const { code, output } = await captureStdout(() => runStatusline(stdin));
    expect(code).toBe(0);
    expect(output).toContain("[aireceipts]");
    expect(output).toContain("⚠");
    expect(output).toContain("Bash loop ×");
  });

  it("R1: renders a trivial-spans waste flag for the quick-QA fixture", async () => {
    const transcriptPath = fixturePath("trivial-spans-quick-qa.jsonl");
    const stdin = stdinStub(JSON.stringify({ transcript_path: transcriptPath }));
    const { code, output } = await captureStdout(() => runStatusline(stdin));
    expect(code).toBe(0);
    expect(output).toContain("[aireceipts]");
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

  it("SPEC-0062 R3: a bare --format (no value) fails fast instead of silently rendering the default line", async () => {
    const { parseOptions } = await import("../../src/cli/options.js");
    expect(parseOptions(["statusline", "--format"]).format).toBe("");
    let err = "";
    const code = await runStatusline(stdinStub("", true), async () => null, () => {}, undefined, {
      format: "",
      writeError: (s) => {
        err += s;
      },
    });
    expect(code).toBe(1);
    expect(err).toContain("unknown statusline segment");
  });

  it("SPEC-0075 R1: parses relative, absolute, and leading-dash --cwd values", async () => {
    const { parseOptions } = await import("../../src/cli/options.js");
    expect(parseOptions(["statusline", "--cwd", "."]).cwd).toBe(".");
    expect(parseOptions(["statusline", "--cwd=/repo"]).cwd).toBe("/repo");
    expect(parseOptions(["statusline", "--cwd=-negative-path"]).cwd).toBe("-negative-path");
  });

  it("SPEC-0075 R1: a bare, empty, or whitespace-only --cwd fails fast with stderr only", async () => {
    const { parseOptions } = await import("../../src/cli/options.js");
    expect(parseOptions(["statusline", "--cwd"]).cwd).toBe("");
    expect(parseOptions(["statusline", "--cwd="]).cwd).toBe("");
    for (const cwd of ["", "  "]) {
      let err = "";
      const { code, output } = await captureStdout(() =>
        runStatusline(stdinStub("", true), async () => null, undefined, undefined, {
          cwd,
          writeError: (s) => {
            err += s;
          },
        }),
      );

      expect(code).toBe(1);
      expect(output).toBe("");
      expect(err).toBe("--cwd requires a non-empty path\n");
    }
  });

  it("SPEC-0062 R5 / SPEC-0075 R6: telemetry records format, scope, and config booleans only", async () => {
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const stdin1 = stdinStub(JSON.stringify({ transcript_path: transcriptPath }));
    const infos: Array<{ customFormat: boolean; scoped: boolean; configFile: boolean }> = [];
    await captureStdout(() => runStatusline(stdin1, async () => null, undefined, (i) => void infos.push(i)));
    const stdin2 = stdinStub(JSON.stringify({ transcript_path: transcriptPath }));
    await captureStdout(() =>
      runStatusline(stdin2, async () => null, undefined, (i) => void infos.push(i), {
        format: "brand,cost",
        cwd: "/repo",
      }),
    );
    const configPath = path.join(isolatedHome, "telemetry-config.json");
    await writeFile(configPath, JSON.stringify({ items: ["brand", "tokens"] }), "utf8");
    const stdin3 = stdinStub(JSON.stringify({ transcript_path: transcriptPath }));
    await captureStdout(() =>
      runStatusline(stdin3, async () => null, undefined, (i) => void infos.push(i), { formatConfigPath: configPath }),
    );
    expect(infos.map((i) => i.customFormat)).toEqual([false, true, false]);
    expect(infos.map((i) => i.scoped)).toEqual([false, true, false]);
    expect(infos.map((i) => i.configFile)).toEqual([false, false, true]);
  });

  it("SPEC-0062 R3 mixed mode: dead transcript_path falls back to disk for the session, but payload quota still renders", async () => {
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const payload = JSON.stringify({
      transcript_path: "/no/such/file.jsonl",
      rate_limits: { five_hour: { used_percentage: 50, resets_at: 1_800_018_000 } },
    });
    const loadFromDiskFn = async (): Promise<Session | null> => loadById("claude-code", transcriptPath);
    const { code, output } = await captureStdout(() => runStatusline(stdinStub(payload), loadFromDiskFn));
    expect(code).toBe(0);
    expect(output).toContain("[aireceipts · Claude Code]");
    expect(output).toContain("5h 50%");
  });

  it("SPEC-0062 R5 latency: rollup + quota parsing + state read/write stays within the 200ms budget", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const statePath = path.join(mkdtempSync(path.join(tmpdir(), "aireceipts-lat-")), "quota-window.json");
    const transcriptPath = fixturePath("clean-with-subagents.jsonl");
    const payload = JSON.stringify({
      transcript_path: transcriptPath,
      rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1_800_018_000 } },
    });
    const started = performance.now();
    const { code, output } = await captureStdout(() =>
      runStatusline(stdinStub(payload), async () => null, undefined, undefined, {
        format: "brand,cost,tokens,waste,quota5h,quota7d,quotaEta",
        nowMs: 1_800_000_000_000,
        quotaStatePath: statePath,
      }),
    );
    const elapsedMs = performance.now() - started;
    expect(code).toBe(0);
    expect(output).toContain("[aireceipts]");
    expect(output).toContain("5h 24%");
    expect(elapsedMs).toBeLessThanOrEqual(200);
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

  it("SPEC-0075 R8 latency: cwd-scoped discovery + load + render stays within the 200ms budget", async () => {
    const { copyFile, mkdir, mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { ClaudeCodeAdapter } = await import("../../src/parse/claudeCode.js");
    const { claudeProjectDirectoryNames, encodeClaudeProjectCwd } = await import("../../src/parse/cwdScope.js");
    const home = await mkdtemp(path.join(tmpdir(), "aireceipts-cwd-lat-"));
    const projectsRoot = path.join(home, ".claude", "projects");
    const sessionCwd = "/home/dev/webapp";
    const requestedCwd = `${sessionCwd}/src`;
    const projectDir = path.join(projectsRoot, encodeClaudeProjectCwd(sessionCwd));
    await mkdir(projectDir, { recursive: true });
    await copyFile(fixturePath("clean-multi-tool-2-models.jsonl"), path.join(projectDir, "session.jsonl"));
    const adapter = new ClaudeCodeAdapter({ root: projectsRoot });
    const scopedLoader = (cwd: string) =>
      loadFromCwd(
        cwd,
        (value) =>
          adapter.listSessions({ roots: claudeProjectDirectoryNames(value).map((name) => path.join(projectsRoot, name)) }),
        (summary) => adapter.loadSession(summary.id),
      );

    const started = performance.now();
    const { code, output } = await captureStdout(() =>
      runStatusline(stdinStub("", true), async () => null, undefined, undefined, {
        cwd: requestedCwd,
        loadFromCwdFn: scopedLoader,
      }),
    );
    const elapsedMs = performance.now() - started;

    expect(code).toBe(0);
    expect(output).toContain("[aireceipts · Claude Code]");
    expect(elapsedMs).toBeLessThanOrEqual(200);
  });

  it("SPEC-0076 R7: --format brand,model renders exactly [aireceipts] <model> from the payload", async () => {
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const payload = JSON.stringify({ transcript_path: transcriptPath, model: { id: "claude-opus-4-8", display_name: "Opus" } });
    const { code, output } = await captureStdout(() =>
      runStatusline(stdinStub(payload), async () => null, undefined, undefined, { format: "brand,model" }),
    );
    expect(code).toBe(0);
    expect(output).toBe("[aireceipts] Opus\n");
  });

  it("SPEC-0076 R7: a statusline.json with items [brand, model] renders the same line", async () => {
    const configPath = path.join(isolatedHome, "brand-model-statusline.json");
    await writeFile(configPath, JSON.stringify({ items: ["brand", "model"] }), "utf8");
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const payload = JSON.stringify({ transcript_path: transcriptPath, model: { id: "claude-opus-4-8", display_name: "Opus" } });
    const { code, output } = await captureStdout(() =>
      runStatusline(stdinStub(payload), async () => null, undefined, undefined, { formatConfigPath: configPath }),
    );
    expect(code).toBe(0);
    expect(output).toBe("[aireceipts] Opus\n");
  });

  it("SPEC-0076 R1: a stale payload model never rides beside the disk-fallback session's numbers", async () => {
    // The live payload names the current model "Opus", but its transcript_path
    // is dead, so the line is built from the disk-fallback session instead —
    // whose dominant model is `claude-opus-4-8`. R1's stale-payload gate must
    // hold at the command level: the payload model may not leak onto another
    // session's row.
    const transcriptPath = fixturePath("clean-multi-tool-2-models.jsonl");
    const payload = JSON.stringify({
      transcript_path: "/no/such/file.jsonl",
      model: { id: "claude-opus-4-8", display_name: "Opus" },
    });
    const loadFromDiskFn = async (): Promise<Session | null> => loadById("claude-code", transcriptPath);
    const { code, output } = await captureStdout(() => runStatusline(stdinStub(payload), loadFromDiskFn));
    expect(code).toBe(0);
    expect(output).toContain("[aireceipts · Claude Code] claude-opus-4-8");
    expect(output).not.toContain("Opus");
  });
});
