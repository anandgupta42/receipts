// SPEC-0044 R3/R4/R5 — the cost matrix runner, the completeness guard, and the
// reconciliation red path. Each populated cell runs a real fixture through the
// real parse→price pipeline and asserts the receipt against its hand-authored
// oracle manifest (never values read back from the code under test).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { adapterFor } from "../../src/parse/registry.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { CursorAdapter } from "../../src/parse/cursor.js";
import type { ReceiptModel } from "../../src/receipt/model.js";
import { AGENTS, MATRIX, SCENARIOS, cellKey, type Cell } from "./cost-matrix.js";

const EPS = 1e-9;
const tmp: string[] = [];
afterAll(() => tmp.forEach((d) => rmSync(d, { force: true, recursive: true })));

async function receiptFor(agent: string, fixture: string): Promise<ReceiptModel> {
  const a = adapterFor(agent as never);
  if (!a) throw new Error(`no adapter for ${agent}`);
  const session = await a.loadSession(fixture);
  if (!session) throw new Error(`adapter returned null for ${fixture}`);
  return buildReceiptModel(session);
}

/** The Cursor unpriceable canonical case builds a tiny composer DB in a temp home. */
async function cursorUnpriceable(): Promise<ReceiptModel> {
  const dir = mkdtempSync(path.join(tmpdir(), "matrix-cursor-"));
  tmp.push(dir);
  const dbPath = path.join(dir, "state.vscdb");
  // The fixture builder writes a full composer DB (session totals only, no
  // per-turn model/usage) — the canonical unpriceable Cursor case.
  const { makeCursorDb } = await import("../fixtures/cursor/makeCursorDb.js");
  const composerId = makeCursorDb({ dbPath });
  const prev = process.env.CURSOR_DB_PATH;
  process.env.CURSOR_DB_PATH = dbPath;
  try {
    const s = await new CursorAdapter().loadSession(composerId);
    if (!s) throw new Error("cursor load null");
    return await buildReceiptModel(s);
  } finally {
    if (prev === undefined) delete process.env.CURSOR_DB_PATH;
    else process.env.CURSOR_DB_PATH = prev;
  }
}

/** total$ must equal the sum of the priced tool rows (or both be null) — the
 *  reconciliation invariant, oracle-independent (it can't be faked if a turn is
 *  dropped). */
function reconciles(m: ReceiptModel): boolean {
  const rowSum = m.toolRows.reduce((s, r) => s + (r.usd ?? 0), 0);
  if (m.totalUsd === null) return m.toolRows.every((r) => r.usd === null);
  return Math.abs(m.totalUsd - rowSum) < Math.max(EPS, Math.abs(m.totalUsd) * 1e-6);
}

describe("SPEC-0044 · cost matrix — every populated cell reconciles + matches its oracle", () => {
  for (const scenario of SCENARIOS) {
    for (const agent of AGENTS) {
      const cell = MATRIX[cellKey(scenario, agent)] as Cell | undefined;
      if (!cell) continue; // caught by the completeness guard
      if ("na" in cell) continue;
      it(`${scenario} · ${agent}`, async () => {
        const m = cell.fixture === "cursor:unpriceable" ? await cursorUnpriceable() : await receiptFor(agent, cell.fixture);
        const exp = cell.expected;
        expect(m.unpriceable, "unpriceable flag").toBe(exp.unpriceable);
        expect(m.totalUsd !== null, "priced (has a $ total)").toBe(exp.priced);
        expect(reconciles(m), "total$ == Σ tool-row $").toBe(true);
        if (exp.rawTokens) {
          // Independent-oracle arithmetic: the receipt's totals equal the raw
          // per-turn sums computed straight from the fixture bytes.
          expect(m.totalTokens.input, "total input tokens vs raw oracle").toBe(exp.rawTokens.input);
          expect(m.totalTokens.output, "total output tokens vs raw oracle").toBe(exp.rawTokens.output);
          expect(m.totalTokens.cacheRead, "total cache-read tokens vs raw oracle").toBe(exp.rawTokens.cacheRead);
          expect(m.totalTokens.cacheCreation, "total cache-creation tokens vs raw oracle").toBe(exp.rawTokens.cacheCreation);
        }
        for (const w of exp.waste ?? []) {
          expect(m.wasteLines.some((l) => l.kind === w), `waste ${w} detected`).toBe(true);
        }
      });
    }
  }
});

describe("SPEC-0044 R4 · completeness — no silently-uncovered cell", () => {
  it("every (scenario, agent) pair is populated or n/a with a non-empty reason", () => {
    const missing: string[] = [];
    const emptyReason: string[] = [];
    for (const scenario of SCENARIOS) {
      for (const agent of AGENTS) {
        const cell = MATRIX[cellKey(scenario, agent)] as Cell | undefined;
        if (!cell) missing.push(cellKey(scenario, agent));
        else if ("na" in cell && cell.na.trim().length === 0) emptyReason.push(cellKey(scenario, agent));
      }
    }
    expect(missing, "uncovered cells").toEqual([]);
    expect(emptyReason, "n/a cells with an empty reason").toEqual([]);
  });

  it("populated cells declare a fixture; n/a cells declare a reason (no half-cells)", () => {
    for (const [key, cell] of Object.entries(MATRIX)) {
      if ("na" in cell) expect(cell.na.length, `${key} n/a reason`).toBeGreaterThan(0);
      else expect(cell.fixture.length, `${key} fixture`).toBeGreaterThan(0);
    }
  });
});

describe("SPEC-0044 R5 · reconciliation red path — the oracle is independent of the code", () => {
  it("dropping a turn from a fixture breaks its hand-authored token oracle", async () => {
    const cell = MATRIX[cellKey("clean-multi-tool", "claude-code")] as { fixture: string; expected: { rawTokens: { input: number } } };
    // Green: the pristine fixture matches its oracle (asserted in the matrix run too).
    const pristine = await receiptFor("claude-code", cell.fixture);
    expect(pristine.totalTokens.input).toBe(cell.expected.rawTokens.input);

    // Red: mutate a copy to drop the LAST assistant turn (a real regression shape
    // — a silently-lost turn), keep the manifest stale → the oracle must fail.
    const dir = mkdtempSync(path.join(tmpdir(), "matrix-red-"));
    tmp.push(dir);
    const copy = path.join(dir, "mutated.jsonl");
    const lines = readFileSync(cell.fixture, "utf8").split("\n").filter((l) => l.trim());
    // Drop the last line that carries a usage object (an assistant turn).
    let dropped = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes("usage")) { dropped = i; break; }
    }
    expect(dropped, "found a usage-bearing turn to drop").toBeGreaterThan(-1);
    lines.splice(dropped, 1);
    writeFileSync(copy, lines.join("\n") + "\n");

    const mutated = await receiptFor("claude-code", copy);
    // The stale oracle (pristine's input) must NOT match the mutated receipt —
    // proving the manifest is an independent oracle, not read back from the code.
    expect(mutated.totalTokens.input).not.toBe(cell.expected.rawTokens.input);
  });
});
