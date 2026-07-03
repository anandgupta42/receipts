// SPEC-0028 R3 — time-integrity caveats: facts attached to the number, never
// a `$` change (I2). Silent on consistent sessions so every existing render
// stays byte-identical (I5/goldens).
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAVEAT_MTIME_SLACK_MS, detectTimeCaveats } from "../../src/receipt/caveats.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { renderReceipt } from "../../src/receipt/render.js";
import { loadById } from "../../src/parse/load.js";
import type { Session, Turn } from "../../src/parse/types.js";
import { emptyUsage, withTotal } from "../../src/parse/util.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

function turn(index: number, timestamp: number, usage = withTotal({ ...emptyUsage(), input: 50, output: 5 })): Turn {
  return { index, timestamp, usage, toolCalls: [] };
}

function session(over: Partial<Session> = {}): Session {
  const turns = over.turns ?? [turn(0, 1000), turn(1, 2000)];
  return {
    id: "s",
    source: "claude-code",
    filePath: "s.jsonl",
    startedAt: 1000,
    endedAt: 2000,
    totals: { tokens: withTotal({ ...emptyUsage(), input: 100, output: 10 }), turnCount: turns.length, toolCallCount: 0 },
    turns,
    ...over,
  };
}

describe("detectTimeCaveats", () => {
  it("stays silent when turn timestamps precede the file mtime", () => {
    expect(detectTimeCaveats(session(), () => 10_000)).toEqual([]);
  });

  it("flags a turn timestamp past mtime + slack", () => {
    const s = session({ turns: [turn(0, 1000), turn(1, 10_000 + CAVEAT_MTIME_SLACK_MS + 1)] });
    const findings = detectTimeCaveats(s, () => 10_000);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe("time-mtime");
    expect(findings[0].text).toContain("turn 2");
  });

  it("respects the write-slack boundary exactly (at the limit → silent)", () => {
    const s = session({ turns: [turn(0, 10_000 + CAVEAT_MTIME_SLACK_MS)] });
    expect(detectTimeCaveats(s, () => 10_000)).toEqual([]);
  });

  it("flags a non-positive span that carries usage", () => {
    const findings = detectTimeCaveats(session({ startedAt: 2000, endedAt: 2000 }), () => 10_000);
    expect(findings.some((f) => f.kind === "time-span")).toBe(true);
  });

  it("stays silent on a non-positive span WITHOUT usage (nothing misrepresented)", () => {
    const s = session({
      startedAt: 2000,
      endedAt: 2000,
      turns: [{ index: 0, timestamp: 1000, toolCalls: [] }],
      totals: { tokens: emptyUsage(), turnCount: 1, toolCallCount: 0 },
    });
    expect(detectTimeCaveats(s, () => 10_000)).toEqual([]);
  });

  it("stays silent when the file cannot be statted (no evidence, no accusation)", () => {
    expect(detectTimeCaveats(session(), () => undefined)).toEqual([]);
  });
});

describe("caveats through the receipt surfaces", () => {
  it("committed fixtures carry zero caveats — goldens cannot move", async () => {
    const s = (await loadById("claude-code", path.join(FIX, "claude-code", "clean-multi-tool-2-models.jsonl")))!;
    const model = await buildReceiptModel(s);
    expect(model.caveats).toEqual([]);
  });

  it("renders a muted caveat line and keeps `$` math unchanged on a tokens-only session", async () => {
    // A session with a caveat but no priceable model: the caveat must render
    // while the total stays tokens-only — a caveat is never a $ change (I2).
    const s = session({
      turns: [turn(0, 1000), turn(1, Date.now() + CAVEAT_MTIME_SLACK_MS + 60_000)],
      filePath: path.join(FIX, "claude-code", "clean-multi-tool-2-models.jsonl"),
    });
    const model = await buildReceiptModel(s);
    expect(model.caveats.some((c) => c.kind === "time-mtime")).toBe(true);
    expect(model.totalUsd).toBeNull();
    const text = renderReceipt(model, { color: false });
    expect(text).toContain("caveat: turn 2 timestamp postdates transcript file");
    expect(text).not.toContain("$");
  });
});
