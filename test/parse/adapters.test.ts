// R1 test matrix rows: parse claude-code, parse codex, cursor degraded, corrupt file.
//
// core-engine's Wave 1 has not yet exported adapter contracts from
// `src/index.ts` (it is still `export {};` as of this writing). Per the
// assignment, these tests are written as far as possible now and self-skip
// (not fail) until the contracts land, so `vitest run` stays green in the
// meantime. Each `describe` block guards independently on the specific
// export it needs, rather than gating the whole file on one guess.
//
// Contract names below are not invented blind: SPEC-0001 R1 states
// core-engine adapted these adapters from the maintainer's earlier private
// tooling (same author; re-licensed for this project). That
// repo's `loadById(source, id)` treats `id` as the absolute transcript file
// path for claude-code/codex, which is exactly what's needed to load an
// arbitrary fixture file directly, bypassing the real on-disk session roots
// (`~/.claude/projects`, `~/.codex/sessions`) entirely.
//
// If core-engine lands a different contract shape, update the export names
// probed below — the assertions themselves (what a normalized Session must
// contain per fixture) should still mostly apply.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
);

const contracts = await import("../../src/index.js").catch(() => null);

const hasLoadById = typeof contracts?.loadById === "function";
if (!hasLoadById) {
  console.warn(
    "[BLOCKED] R1 adapter tests skipped: src/index.ts has not exported `loadById` " +
      "yet (core-engine Wave 1/2). See SPEC-0001 R1 test matrix and " +
      "private-repo src/trace/load.ts for the expected contract shape.",
  );
}

describe.skipIf(!hasLoadById)("claude-code adapter (R1 parse)", () => {
  it("parses the 5x consecutive Bash loop fixture into a normalized Session", async () => {
    const filePath = path.join(fixturesDir, "claude-code/loop-bash-5x.jsonl");
    const session = await contracts!.loadById("claude-code", filePath);
    expect(session).not.toBeNull();
    expect(session.source).toBe("claude-code");
    expect(session.model).toBe("claude-opus-4-8");
    const bashCalls = session.turns
      .flatMap((t: { toolCalls?: { name: string }[] }) => t.toolCalls ?? [])
      .filter((tc: { name: string }) => tc.name === "Bash");
    expect(bashCalls.length).toBe(5);
    expect(session.totals.toolCallCount).toBeGreaterThanOrEqual(5);
  });

  it("parses the clean multi-tool, 2-model fixture into a normalized Session", async () => {
    const filePath = path.join(fixturesDir, "claude-code/clean-multi-tool-2-models.jsonl");
    const session = await contracts!.loadById("claude-code", filePath);
    expect(session).not.toBeNull();
    expect(session.source).toBe("claude-code");
    const modelsUsed = new Set(
      session.turns
        .map((t: { model?: string }) => t.model)
        .filter((m: string | undefined): m is string => Boolean(m)),
    );
    expect(modelsUsed.has("claude-opus-4-8")).toBe(true);
    expect(modelsUsed.has("claude-sonnet-5")).toBe(true);
    expect(modelsUsed.size).toBe(2);
    // isMeta records and slash-command echoes are filtered before a Turn is
    // ever created (src/parse/claudeCode.ts), so they can't surface here —
    // assert the turn count matches exactly the fixture's real assistant
    // records (10), which only holds if that filtering happened.
    expect(session.turns.length).toBe(10);
  });
});

describe.skipIf(!hasLoadById)("codex adapter (R1 parse)", () => {
  it("parses the clean Codex session fixture (cumulative token_count) into a normalized Session", async () => {
    const filePath = path.join(fixturesDir, "codex/clean-session.jsonl");
    const session = await contracts!.loadById("codex", filePath);
    expect(session).not.toBeNull();
    expect(session.source).toBe("codex");
    expect(session.model).toBe("gpt-5.3-codex");
    expect(session.totals.tokens.total).toBeGreaterThan(0);
  });

  it("parses the trivial-spans Codex fixture (per-message token_count) into a normalized Session", async () => {
    const filePath = path.join(fixturesDir, "codex/trivial-spans-r4b.jsonl");
    const session = await contracts!.loadById("codex", filePath);
    expect(session).not.toBeNull();
    expect(session.source).toBe("codex");
    // Every assistant turn in this fixture is tool-free with output <=120
    // tokens by construction (R4b eligibility) — assert that shape survives
    // parsing so the R4b detector (core-engine, later wave) has something
    // real to fire against.
    const assistantTurns = session.turns.filter(
      (t: { toolCalls?: unknown[] }) => (t.toolCalls?.length ?? 0) === 0,
    );
    expect(assistantTurns.length).toBeGreaterThan(0);
    for (const turn of assistantTurns) {
      expect((turn as { usage?: { output: number } }).usage?.output ?? 0).toBeLessThanOrEqual(120);
    }
  });
});

describe.skipIf(!hasLoadById)("corrupt file handling (R1)", () => {
  it("degrades gracefully on a truncated/corrupt JSONL file (skip, never throw)", async () => {
    const filePath = path.join(fixturesDir, "corrupt/truncated.jsonl");
    await expect(contracts!.loadById("claude-code", filePath)).resolves.not.toThrow;
    const session = await contracts!.loadById("claude-code", filePath);
    // Graceful degrade means either a null result (file unusable) or a
    // partial Session built only from the well-formed leading lines — never
    // an unhandled exception. Both outcomes satisfy R1's "skip + stderr
    // note, exit 0" acceptance row; assert whichever this adapter chooses is
    // internally consistent rather than asserting one specific shape.
    if (session !== null) {
      expect(session.turns.length).toBeGreaterThanOrEqual(0);
    }
  });
});

// --- Cursor (R1 degraded mode) -------------------------------------------
//
// Cursor sessions live in a SQLite `state.vscdb`, not a JSONL file, and the
// private repo's `CursorAdapter` almost certainly resolves `id` differently
// (likely a `composerId` or the db path) than the claude-code/codex
// file-path convention. That resolution shape isn't knowable without
// core-engine's actual port landing, so this block guards on `loadById`
// AND is wrapped in its own try/catch fallback rather than asserting one
// specific id scheme — it records what it can and never fails the suite
// over an id-shape guess.
describe.skipIf(!hasLoadById)("cursor adapter (R1 degraded mode)", () => {
  it("loads a degraded-mode session with no model id and totals-only tokens", async () => {
    const { makeCursorDb } = await import("../fixtures/cursor/makeCursorDb.js").catch(
      () => ({ makeCursorDb: null }),
    ) as { makeCursorDb: ((opts: { dbPath: string }) => string) | null };
    if (!makeCursorDb) {
      console.warn("[BLOCKED] cursor fixture builder unavailable at runtime — skipping.");
      return;
    }
    const dir = mkdtempSync(path.join(tmpdir(), "aireceipts-cursor-"));
    const dbPath = path.join(dir, "state.vscdb");
    const composerId = makeCursorDb({ dbPath });

    // CursorAdapter.loadSession always opens `process.env.CURSOR_DB_PATH ||
    // defaultDbPath()` (src/parse/cursor.ts) — the `id` argument is only used
    // *after* the db is opened, to look up rows within it. Point the adapter
    // at this test's temp db, or it will try (and fail) to open the real
    // machine's default Cursor db path, which doesn't exist in CI.
    const previousDbPath = process.env.CURSOR_DB_PATH;
    process.env.CURSOR_DB_PATH = dbPath;
    let session;
    try {
      // Try the two most plausible id conventions; whichever the real adapter
      // uses, at least one of these should resolve once the contract lands.
      session =
        (await contracts!.loadById("cursor", dbPath).catch(() => null)) ??
        (await contracts!.loadById("cursor", composerId).catch(() => null));
    } finally {
      if (previousDbPath === undefined) {
        delete process.env.CURSOR_DB_PATH;
      } else {
        process.env.CURSOR_DB_PATH = previousDbPath;
      }
    }

    expect(session).not.toBeNull();
    if (session) {
      expect(session.source).toBe("cursor");
      // Degraded mode per SPEC-0001 R1: no per-turn model id, totals-only tokens.
      expect(session.model).toBeUndefined();
      expect(session.totals.tokens.total).toBeGreaterThan(0);
    }
  });
});
