// SPEC-0068 — end-to-end: the same-file re-reads diagnostic renders in --details
// and --json as a STANDALONE block, and is never a waste row or a savings claim (R4/R5).
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { detailsBlocks } from "../../src/receipt/present.js";
import { toJsonModel } from "../../src/receipt/json.js";
import { receiptJsonSchema } from "../../src/receipt/exportSchema.js";
import type { Session, SessionTotals, TokenUsage, ToolCall, Turn } from "../../src/parse/types.js";

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/prices");
const JUNE_15_2026 = Date.UTC(2026, 5, 15, 10, 0, 0);

function usage(input: number): TokenUsage {
  return { total: input, input, output: 0, cacheRead: 0, cacheCreation: 0 };
}
function readTurn(index: number): Turn {
  const call: ToolCall = { name: "Read", input: { file_path: "a.ts" } };
  return { index, timestamp: JUNE_15_2026, model: "claude-haiku-4-5", usage: usage(1_000_000), toolCalls: [call] };
}
function reReadSession(): Session {
  const totals: SessionTotals = { tokens: usage(3_000_000), turnCount: 3, toolCallCount: 3 };
  return { id: "s", source: "claude-code", filePath: "/f.jsonl", totals, turns: [readTurn(0), readTurn(1), readTurn(2)] };
}

describe("SPEC-0068 same-file re-reads — render/json integration", () => {
  it("populates the model and renders in --details", async () => {
    const model = await buildReceiptModel(reReadSession(), dataDir);
    expect(model.sameFileReReads?.count).toBe(2);
    const details = detailsBlocks(model);
    const row = details.find((b) => b.kind === "row" && b.label === "same-file re-reads");
    expect(row).toBeDefined();
    // low-confidence caveat note is present
    expect(details.some((b) => b.kind === "note" && /low conf/.test(b.text))).toBe(true);
  });

  it("emits a standalone --json block that validates, with confidence low", async () => {
    const model = await buildReceiptModel(reReadSession(), dataDir);
    const json = toJsonModel(model);
    expect(json.sameFileReReads?.count).toBe(2);
    expect(json.sameFileReReads?.confidence).toBe("low");
    expect(receiptJsonSchema.safeParse(json).success).toBe(true);
  });

  it("is NOT a waste row and carries no savings claim (R4)", async () => {
    const model = await buildReceiptModel(reReadSession(), dataDir);
    const json = toJsonModel(model);
    // The R4 guarantee: same-file re-reads is a STANDALONE block, never a WasteLine kind,
    // so it can never be summed into the handoff/PR "could have saved" $ (which only sums
    // WasteLine.usd). Other real waste (e.g. stuck-loop) may co-fire — that's fine, they are
    // independent diagnostics — but no waste row is ever `same-file-rereads`.
    expect(json.wasteLines.some((w) => (w as { kind?: string }).kind === "same-file-rereads")).toBe(false);
    expect(json.sameFileReReads).not.toBeNull();
  });

  it("is null (no block) when there are no re-reads", async () => {
    const totals: SessionTotals = { tokens: usage(1_000_000), turnCount: 1, toolCallCount: 1 };
    const single: Session = { id: "s", source: "claude-code", filePath: "/f.jsonl", totals, turns: [readTurn(0)] };
    const json = toJsonModel(await buildReceiptModel(single, dataDir));
    expect(json.sameFileReReads).toBeNull();
  });
});
