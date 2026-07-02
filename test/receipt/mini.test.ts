// SPEC-0006 R4: the shared mini-summary + 6-line render. Asserts the structural
// contract (exactly 6 lines, tokens-only zero-`$` honesty when unpriced),
// byte-equality against the committed goldens (I5), and that the render is a
// pure function of the shared `MiniSummary` (one model, two surfaces).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/index.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { buildMiniSummary, renderMiniReceipt, renderMiniSummary } from "../../src/receipt/mini.js";
import type { ReceiptModel } from "../../src/receipt/model.js";

const PRICED = "test/fixtures/claude-code/clean-multi-tool-2-models.jsonl";
const UNPRICED = "test/fixtures/claude-code/unpriced-unknown-model.jsonl";
const LOOP = "test/fixtures/claude-code/loop-bash-5x.jsonl";

async function modelOf(path: string): Promise<ReceiptModel> {
  const session = await loadById("claude-code", path);
  expect(session).not.toBeNull();
  return buildReceiptModel(session!);
}

describe("renderMiniReceipt (R4)", () => {
  it("renders exactly 6 lines for a priced session", async () => {
    const out = renderMiniReceipt(await modelOf(PRICED));
    expect(out.split("\n")).toHaveLength(6);
  });

  it("renders exactly 6 lines for an unpriced session", async () => {
    const out = renderMiniReceipt(await modelOf(UNPRICED));
    expect(out.split("\n")).toHaveLength(6);
  });

  it("emits zero `$` bytes when the session is unpriced (I2)", async () => {
    const out = renderMiniReceipt(await modelOf(UNPRICED));
    expect(out).not.toContain("$");
    expect(out).toContain("tok");
  });

  it("shows a `$` total when the session priced (I2)", async () => {
    const out = renderMiniReceipt(await modelOf(PRICED));
    expect(out).toContain("total  $");
  });

  it("surfaces the top waste line when one fired", async () => {
    const out = renderMiniReceipt(await modelOf(LOOP));
    expect(out).toContain("⚠");
    expect(out).toContain("loop ×5");
  });

  it("says 'no waste detected' on a clean session", async () => {
    const out = renderMiniReceipt(await modelOf(PRICED));
    expect(out).toContain("no waste detected");
    expect(out).not.toContain("⚠");
  });

  it("leads with the brand header and ends with the full-receipt footer", async () => {
    const lines = renderMiniReceipt(await modelOf(PRICED)).split("\n");
    expect(lines[0]).toBe("aireceipts · session receipt");
    expect(lines[5]).toBe("run  aireceipts  for the full receipt");
  });

  it("is byte-identical to the committed priced golden (I5)", async () => {
    const out = renderMiniReceipt(await modelOf(PRICED)) + "\n";
    expect(out).toBe(readFileSync("goldens/mini/claude-code-clean-multi-tool-2-models.txt", "utf8"));
  });

  it("is byte-identical to the committed unpriced golden (I5)", async () => {
    const out = renderMiniReceipt(await modelOf(UNPRICED)) + "\n";
    expect(out).toBe(readFileSync("goldens/mini/claude-code-unpriced-unknown-model.txt", "utf8"));
  });
});

describe("buildMiniSummary (shared structure, SPEC-0006 R4 / SPEC-0007)", () => {
  it("reduces the receipt model to the shared fields without recomputing", async () => {
    const model = await modelOf(PRICED);
    const summary = buildMiniSummary(model);
    expect(summary.agentLabel).toBe("Claude Code");
    expect(summary.model).toBe("claude-opus-4-8");
    expect(summary.totalUsd).toBe(model.totalUsd);
    expect(summary.topTool?.tool).toBe(model.toolRows[0]?.tool);
    expect(summary.durationMs).toBe(model.durationMs);
  });

  it("carries totalUsd=null for an unpriced session so the surface can go tokens-only", async () => {
    const summary = buildMiniSummary(await modelOf(UNPRICED));
    expect(summary.totalUsd).toBeNull();
    expect(summary.totalTokens).toBeGreaterThan(0);
  });

  it("renderMiniReceipt equals renderMiniSummary(buildMiniSummary(...)) — render is a pure fn of the summary", async () => {
    const model = await modelOf(PRICED);
    expect(renderMiniReceipt(model)).toBe(renderMiniSummary(buildMiniSummary(model)));
  });
});

describe("renderMiniSummary edge cases", () => {
  it("degrades cleanly when no model, no tools, and unknown duration", () => {
    const out = renderMiniSummary({
      agentLabel: "Cursor",
      model: null,
      durationMs: undefined,
      totalUsd: null,
      totalTokens: 5000,
      topTool: null,
      topWaste: null,
      unpriceable: true,
    });
    const lines = out.split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[1]).toBe("Cursor · model unknown · duration unknown");
    expect(lines[2]).toBe("total  5,000 tok");
    expect(lines[3]).toBe("top    (no tool calls)");
    expect(out).not.toContain("$");
  });
});
