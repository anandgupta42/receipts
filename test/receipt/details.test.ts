// SPEC-0054 render surface: R1's price-delta percentage, R2's stuck-loop turn
// location (text + SVG), and R4/R5's opt-in DETAILS section — presence AND
// absence per line, the 50-char width contract, placement, downward-rounded
// BY MODEL rows, and the honesty battery over a details view. Real fixtures
// carry the priced/loop paths; in-memory models pin the conditional edges the
// fixtures don't reach (TTL split, unpriced sessions, absent peak turn).
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/parse/load.js";
import { buildReceiptModel, type ReceiptModel } from "../../src/receipt/model.js";
import { buildReceiptView, detailsBlocks } from "../../src/receipt/present.js";
import { renderReceipt, renderReceiptLines } from "../../src/receipt/render.js";
import { renderReceiptSvg } from "../../src/receipt/svg.js";
import { INSTALL_FOOTER_TEXT } from "../../src/receipt/branding.js";
import { validateReceiptBlocks } from "../../src/receipt/blocks.js";
import type { Block } from "../../src/receipt/blocks.js";
import { emptyUsage, withTotal } from "../../src/parse/util.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, "..", "fixtures", "claude-code");
const PRICED = path.join(FIXTURES, "clean-multi-tool-2-models.jsonl");
const LOOP = path.join(FIXTURES, "loop-bash-5x.jsonl");

async function modelFor(fixture: string): Promise<ReceiptModel> {
  const session = await loadById("claude-code", fixture);
  expect(session).not.toBeNull();
  return buildReceiptModel(session!);
}

/** Strip ANSI-free rendered lines for the priced fixture's details view. */
async function pricedDetailsLines(): Promise<string[]> {
  return renderReceiptLines(await modelFor(PRICED), { color: false, details: true });
}

describe("SPEC-0054 R1 — price-delta percentage", () => {
  it("renders the floor percentage separately and leaves the prediction note byte-identical", async () => {
    const text = renderReceipt(await modelFor(PRICED), { color: false });
    expect(text).toMatch(/same tokens on claude-haiku-4-5\.+≥ \$0\.03/u);
    expect(text).toContain("  (78% lower observable floor)");
    expect(text).toContain("  (arithmetic, not a prediction)");
  });

  it("never renders 0% or 100% for a genuinely partial delta (honest bounds)", async () => {
    const model = await modelFor(PRICED);
    const near100 = { ...model, priceDelta: { cheaperModel: "claude-haiku-4-5", usd: 0.0001, actualUsd: 100 } };
    const near0 = { ...model, priceDelta: { cheaperModel: "claude-haiku-4-5", usd: 99.999, actualUsd: 100 } };
    expect(renderReceipt(near100, { color: false })).toContain("(>99% lower observable floor)");
    expect(renderReceipt(near0, { color: false })).toContain("(<1% lower observable floor)");
  });

  it("renders no suffix when the delta is not a saving (usd >= actualUsd) or actualUsd is 0", async () => {
    const model = await modelFor(PRICED);
    const noSaving = { ...model, priceDelta: { cheaperModel: "claude-haiku-4-5", usd: 0.2, actualUsd: 0.18 } };
    const zeroActual = { ...model, priceDelta: { cheaperModel: "claude-haiku-4-5", usd: 0, actualUsd: 0 } };
    expect(renderReceipt(noSaving, { color: false })).not.toContain("% lower observable floor)");
    expect(renderReceipt(zeroActual, { color: false })).not.toContain("% lower observable floor)");
  });
});

describe("SPEC-0054 R2 — stuck-loop turn location", () => {
  it("renders the 1-based min-max span as the waste row's detail sub-line", async () => {
    const text = renderReceipt(await modelFor(LOOP), { color: false });
    expect(text).toContain("⚠ Bash loop ×5");
    expect(text).toContain("  at turns 1-5");
  });

  it("renders the singular form for a run confined to one turn", async () => {
    const model = await modelFor(LOOP);
    const single = {
      ...model,
      wasteLines: model.wasteLines.map((w) => (w.kind === "stuck-loop" ? { ...w, turnIndices: [3] } : w)),
    };
    expect(renderReceipt(single, { color: false })).toContain("  at turn 4");
  });

  it("SVG renders the detail text for a badged (stuck-loop) waste row", async () => {
    const svg = renderReceiptSvg(await modelFor(LOOP));
    expect(svg).toContain("at turns 1-5");
  });
});

describe("SPEC-0054 R4 — the DETAILS section", () => {
  it("renders composition, counts, peak turn, counterfactual, and BY MODEL on the priced fixture", async () => {
    const text = (await pricedDetailsLines()).join("\n");
    expect(text).toContain("DETAILS");
    expect(text).toMatch(/tokens in \/ out\.+20k \/ 897/u);
    expect(text).toMatch(/cache read \/ write\.+124k \/ 2\.1k/u);
    expect(text).toMatch(/turns \/ tool calls\.+10 \/ 8/u);
    expect(text).toMatch(/peak turn\.+24k tok \(turn 7\)/u);
    expect(text).toMatch(/same reads at uncached input rate\.+≥ \$0\.51/u);
    expect(text).toContain("BY MODEL");
  });

  it("keeps every rendered line inside the 50-char receipt width", async () => {
    for (const line of await pricedDetailsLines()) {
      expect([...line].length, line).toBeLessThanOrEqual(50);
    }
  });

  it("places DETAILS after the price-delta note and before the footer (SPEC-0055: the card carries no methodology footnote)", async () => {
    const lines = await pricedDetailsLines();
    const details = lines.findIndex((l) => l.trim() === "DETAILS");
    const deltaNote = lines.findIndex((l) => l.includes("(arithmetic, not a prediction)"));
    const footer = lines.findIndex((l) => l.trim() === INSTALL_FOOTER_TEXT);
    expect(details).toBeGreaterThan(deltaNote);
    expect(details).toBeLessThan(footer);
  });

  it("BY MODEL rows independently round down", async () => {
    const model = await modelFor(PRICED);
    const lines = renderReceiptLines(model, { color: false, details: true });
    const byModel = lines.filter((l) => /% · ≥ \$\d/u.test(l));
    expect(byModel.length).toBe(model.modelMix.length);
    const shown = byModel.map((l) => Number(l.match(/\$(\d+\.\d+)$/u)![1]));
    model.modelMix.forEach((entry, index) => expect(shown[index]).toBeLessThanOrEqual(entry.usd as number));
  });

  it("uses one four-decimal ledger precision when sub-cent model atoms cross one cent", async () => {
    const model = await modelFor(PRICED);
    const first = model.modelMix[0]!;
    model.modelMix = [
      { ...first, model: "model-a", usd: 0.006, tokenShare: 0.5 },
      { ...first, model: "model-b", usd: 0.006, tokenShare: 0.5 },
    ];
    model.toolRows = [{ ...model.toolRows[0], usd: 0.012 }];
    model.totalUsd = 0.012;
    model.priceDelta = null;
    const text = renderReceiptLines(model, { color: false, details: true }).join("\n");
    expect(text).toContain("TOTAL");
    expect(text).toContain("≥ $0.0120");
    expect(text).toContain("model-a");
    expect(text.match(/≥ \$0\.0060/g)).toHaveLength(2);
  });

  it("labels model details as parent-only when TOTAL includes subagents", async () => {
    const model = await modelFor(PRICED);
    model.subagents = { count: 1, pricedUsd: 0.03, tokensTotal: 100, unpricedCount: 0, unreadableCount: 0 };
    const text = renderReceiptLines(model, { color: false, details: true }).join("\n");
    expect(text).toContain("BY PARENT MODEL");
    expect(text.split("\n")).not.toContain("BY MODEL");
  });

  it("omits BY MODEL for a single-model session and the counterfactual when null", async () => {
    const model = await modelFor(LOOP); // single model, zero cacheRead counterfactual applies
    const text = renderReceiptLines({ ...model, cacheReadAtInputRateUsd: null }, { color: false, details: true }).join("\n");
    expect(text).not.toContain("BY MODEL");
    expect(text).not.toContain("same reads at uncached input rate");
  });

  it("renders the TTL split sub-line only when the transcript reported it (absent split ≠ 0)", async () => {
    const model = await modelFor(PRICED);
    const noSplit = renderReceiptLines(model, { color: false, details: true }).join("\n");
    expect(noSplit).not.toContain("writes:");

    const split = {
      ...model,
      totalTokens: { ...model.totalTokens, cacheCreation5m: 1500, cacheCreation1h: 600 },
    };
    const text = renderReceiptLines(split, { color: false, details: true }).join("\n");
    expect(text).toContain("writes: 5m 1.5k · 1h 600");
  });

  it("renders a lone reported TTL tier without fabricating a 0 for the missing one", async () => {
    const model = await modelFor(PRICED);
    const only5m = { ...model, totalTokens: { ...model.totalTokens, cacheCreation5m: 1500 } };
    const text5m = renderReceiptLines(only5m, { color: false, details: true }).join("\n");
    expect(text5m).toContain("writes: 5m 1.5k");
    expect(text5m).not.toContain("1h");

    const only1h = { ...model, totalTokens: { ...model.totalTokens, cacheCreation1h: 600 } };
    const text1h = renderReceiptLines(only1h, { color: false, details: true }).join("\n");
    expect(text1h).toContain("writes: 1h 600");
    expect(text1h).not.toContain("5m");
  });

  it("BY MODEL on a mixed-coverage session renders the unpriced model's tokens, never a fabricated $ (I2)", async () => {
    const model = await modelFor(path.join(FIXTURES, "mixed-priced-coverage.jsonl"));
    expect(model.totalUsd).not.toBeNull();
    expect(model.modelMix.some((m) => m.usd === null)).toBe(true);
    const lines = renderReceiptLines(model, { color: false, details: true });
    const section = lines.slice(lines.findIndex((l) => l.trim() === "BY MODEL") + 1);
    const unpricedRow = section.find((l) => l.startsWith("claude-opus-4-legacy"));
    expect(unpricedRow).toBeDefined();
    expect(unpricedRow).toContain("tok");
    expect(unpricedRow).not.toContain("$");
    const pricedRow = section.find((l) => l.startsWith("claude-opus-4-8"));
    expect(pricedRow).toContain("$");
  });

  it("omits the peak-turn row when no turn carried usage", async () => {
    const model = await modelFor(PRICED);
    const withoutPeak = { ...model, peakTurn: undefined };
    const text = renderReceiptLines(withoutPeak, { color: false, details: true }).join("\n");
    expect(text).not.toContain("peak turn");
  });

  it("renders zero '$' bytes on an unpriced session with details on (I2)", async () => {
    const model = await modelFor(PRICED);
    const tokens = withTotal({ ...emptyUsage(), input: 5000, output: 900, cacheRead: 2000 });
    const unpriced: ReceiptModel = {
      ...model,
      totalUsd: null,
      priceDelta: null,
      totalTokens: tokens,
      sessionTotalTokens: tokens,
      caveats: [],
      cacheReadAtInputRateUsd: null,
      toolRows: model.toolRows.map((r) => ({ ...r, usd: null })),
      modelMix: model.modelMix.map((m) => ({ ...m, usd: null })),
      wasteLines: [],
    };
    const text = renderReceiptLines(unpriced, { color: false, details: true }).join("\n");
    expect(text).toContain("DETAILS");
    expect(text).not.toContain("$");
  });

  it("grocery and datavis ignore the details view (the CLI guards the combination)", async () => {
    const model = await modelFor(PRICED);
    for (const template of ["grocery", "datavis"] as const) {
      expect(renderReceipt(model, { color: false, template, details: true })).toBe(
        renderReceipt(model, { color: false, template }),
      );
    }
  });
});

describe("SPEC-0054 R5 — honesty battery over a details view", () => {
  it("validateReceiptBlocks returns no violations for the priced details view", async () => {
    const model = await modelFor(PRICED);
    const { blocks } = buildReceiptView(model, "classic", { details: true });
    expect(validateReceiptBlocks(blocks, model)).toEqual([]);
  });

  it("still rejects an alien dollar amount smuggled into a details view", async () => {
    const model = await modelFor(PRICED);
    const { blocks } = buildReceiptView(model, "classic", { details: true });
    const smuggled: Block[] = [...blocks, { kind: "note", text: "totally real refund $9,999.99" }];
    const codes = validateReceiptBlocks(smuggled, model).map((v) => v.code);
    expect(codes).toContain("untraced-dollar");
  });

  it("detailsBlocks alone carries only traced dollars (the exported builder is the battery's universe)", async () => {
    const model = await modelFor(PRICED);
    const dollarLines = detailsBlocks(model)
      .flatMap((b) => ("text" in b ? [b.text] : "value" in b ? [b.value] : []))
      .filter((s) => s.includes("$"));
    expect(dollarLines.length).toBeGreaterThan(0);
    expect(validateReceiptBlocks(buildReceiptView(model, "classic", { details: true }).blocks, model)).toEqual([]);
  });
});
