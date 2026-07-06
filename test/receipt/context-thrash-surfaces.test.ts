// SPEC-0017 R7 — the three output surfaces are separate contracts. Built from the
// committed true-positive fixture through the real model builder, so the receipt
// line, `--json` row shape/key-order, and `--handoff` suggestion are all pinned.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/parse/load.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { toJsonModel } from "../../src/receipt/json.js";
import { renderHandoff } from "../../src/receipt/handoff.js";
import { renderReceipt } from "../../src/receipt/render.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = path.join(repoRoot, "data/prices");
const TP = path.join(repoRoot, "test/fixtures/claude-code/context-thrash-3x.jsonl");

async function tpModel() {
  const session = await loadById("claude-code", TP);
  expect(session).not.toBeNull();
  return buildReceiptModel(session!, dataDir);
}

describe("R7 — --json row shape and key order", () => {
  it("emits kind/compactionCount/turnSpan/turnIndices/tokens/usd in that order", async () => {
    const json = toJsonModel(await tpModel());
    const row = json.wasteLines.find((w) => w.kind === "context-thrash");
    expect(row).toBeDefined();
    expect(Object.keys(row!)).toEqual(["kind", "compactionCount", "turnSpan", "turnIndices", "tokens", "usd"]);
    expect(row).toMatchObject({ kind: "context-thrash", compactionCount: 3, turnSpan: 4, turnIndices: [4, 5, 6, 7] });
    expect((row as { usd: number }).usd).toBeGreaterThan(0);
    expect((row as { tokens: { output: number } }).tokens.output).toBe(0);
  });
});

describe("R7 — text receipt line + methodology sentence", () => {
  it("renders `≈ context thrash: N compactions in M turns` and one methodology sub-line", async () => {
    const text = renderReceipt(await tpModel(), { color: false });
    expect(text).toContain("≈ context thrash: 3 compactions in 4 turns");
    expect(text).toContain("context refilled ≥80% of peak within 5 turns");
  });
});

describe("R7 — --handoff static suggestion", () => {
  it("pairs the context-thrash evidence line with the clear/split-context rule (SPEC-0059 R3 form)", async () => {
    const handoff = renderHandoff(await tpModel());
    // Evidence via the receipt's own wasteRowBlock label (shared, not re-derived).
    expect(handoff).toContain("≈ context thrash: 3 compactions in 4 turns");
    expect(handoff).toContain("→ clear or split context at task boundaries");
  });
});
