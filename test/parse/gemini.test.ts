// SPEC-0010 R3 — Gemini CLI full-fidelity adapter. Covers the test-matrix rows
// that the eval/golden batteries don't assert directly: the per-field usage
// mapping (thoughts→output, cached subset, tool→input, cacheCreation zeroed),
// the last-wins dedupe + $rewindTo truncation, vendor resolution to google,
// the no-price-row degrade, corrupt-file safety, and chats/ discovery.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { attributeByTool, GeminiAdapter, loadById, vendorForSource } from "../../src/index.js";
import { buildReceiptModel } from "../../src/receipt/model.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const clean = path.join(fixturesDir, "gemini/clean-session.jsonl");
const proModel = path.join(fixturesDir, "gemini/unpriced-pro-model.jsonl");
const rewind = path.join(fixturesDir, "gemini/rewind-dedupe.jsonl");
const corrupt = path.join(fixturesDir, "corrupt/truncated.jsonl");

describe("gemini adapter (R3 parse)", () => {
  it("parses a clean session: per-turn model, tool calls, and the documented usage mapping", async () => {
    const session = await loadById("gemini", clean);
    expect(session).not.toBeNull();
    expect(session!.source).toBe("gemini");
    expect(session!.model).toBe("gemini-2.5-flash");
    expect(session!.turns.length).toBe(2);
    expect(session!.totals.toolCallCount).toBe(3);

    // Turn 1: input 12000 / output 800 / cached 6000 / thoughts 200 / total 13000.
    const u = session!.turns[0].usage!;
    expect(u.cacheRead).toBe(6000); // cachedContentTokenCount
    expect(u.input).toBe(6000); // promptTokenCount - cached (+ tool, which is 0)
    expect(u.output).toBe(1000); // candidates 800 + thoughts 200 (billed at output rate)
    expect(u.cacheCreation).toBe(0); // Gemini has no cache-write bucket
    expect(u.cacheCreation5m).toBeUndefined();
    expect(u.cacheCreation1h).toBeUndefined();
    expect(u.total).toBe(13000); // withTotal == original totalTokenCount
  });

  it("prices a flash session from google.json and labels it Gemini CLI", async () => {
    const session = await loadById("gemini", clean);
    const model = await buildReceiptModel(session!);
    expect(model.agentLabel).toBe("Gemini CLI");
    expect(model.totalUsd).not.toBeNull();
    expect(model.totalUsd!).toBeGreaterThan(0);
  });

  it("resolves gemini to the google price vendor (single-vendor, R3)", () => {
    expect(vendorForSource("gemini")).toBe("google");
  });

  it("degrades to tokens-only when the per-turn model has no cited price row (I2)", async () => {
    const session = await loadById("gemini", proModel);
    expect(session!.model).toBe("gemini-2.5-pro"); // omitted from google.json (tiered pricing)
    expect(session!.totals.tokens.total).toBe(31600);
    const attribution = await attributeByTool(session!);
    expect(attribution.totalUsd).toBeNull(); // no guessed dollar
  });

  it("dedupes re-appended messages and honors $rewindTo (no double-count, no rewound spend)", async () => {
    const session = await loadById("gemini", rewind);
    expect(session!.turns.length).toBe(1); // msg-4 was rewound away
    // Only msg-2's final re-appended state counts: input 8000 - cached 4000 = 4000.
    expect(session!.totals.tokens.input).toBe(4000);
    expect(session!.totals.tokens.cacheRead).toBe(4000);
    // The rewound msg-4's 99000 input must be absent.
    expect(session!.totals.tokens.input).toBeLessThan(99000);
    expect(session!.turns[0].toolCalls.map((c) => c.name)).toEqual(["read_file", "replace"]);
  });

  it("skips a truncated/corrupt transcript without throwing (exit-0 discipline)", async () => {
    const session = await loadById("gemini", corrupt);
    // Either null or a partial session with a non-negative turn count — never a throw.
    if (session !== null) {
      expect(session.turns.length).toBeGreaterThanOrEqual(0);
    }
  });

  it("discovers only chats/ transcripts under the configured root (R2 detection)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aireceipts-gemini-"));
    const chats = path.join(dir, "projhash", "chats");
    mkdirSync(chats, { recursive: true });
    cpSync(clean, path.join(chats, "session-2026-06-20T11-00-a1b2c3d4.jsonl"));
    // A non-chats file (e.g. a checkpoint) must be ignored by discovery.
    const other = path.join(dir, "projhash", "checkpoints");
    mkdirSync(other, { recursive: true });
    cpSync(clean, path.join(other, "checkpoint-foo.jsonl"));

    const adapter = new GeminiAdapter({ root: dir });
    expect(await adapter.detect()).toBe(true);
    const list = await adapter.listSessions({ full: true });
    expect(list.length).toBe(1);
    expect(list[0].source).toBe("gemini");
    expect(list[0].totals.toolCallCount).toBe(3);
  });
});
