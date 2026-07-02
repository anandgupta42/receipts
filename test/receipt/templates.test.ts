// SPEC-0020 test matrix for receipt templates. The byte-goldens themselves are
// gated by scripts/verify-goldens.mjs (classic = the refactor regression gate,
// grocery/datavis = R5's 4 new artifacts); this file asserts the objective
// properties: the exact-wording honesty battery holds in every template (R3),
// grocery's 50-char column math and truncation (Design), classic-vs-grocery
// numbers agree to the cent, terminal + SVG consume the identical block list
// (block parity), the barcode is deterministic, and the CLI surface (R1 unknown
// name → exit 1; R2 `templates` listing).
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/index.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import type { ReceiptModel } from "../../src/receipt/model.js";
import {
  TEMPLATE_NAMES,
  barcodePattern,
  groceryLine,
  sessionToken,
  validateReceiptBlocks,
  PRICE_DELTA_NOTE,
} from "../../src/receipt/blocks.js";
import type { Block, TemplateName } from "../../src/receipt/blocks.js";
import { METHODOLOGY_BRIEF } from "../../src/pricing/attribution.js";
import { buildReceiptView } from "../../src/receipt/present.js";
import { renderReceipt, renderReceiptLines, RECEIPT_WIDTH } from "../../src/receipt/render.js";
import { renderReceiptSvg } from "../../src/receipt/svg.js";
import { previewModel } from "../../src/receipt/preview.js";
import { main } from "../../src/cli/index.js";

const PRICED = { source: "claude-code", path: "test/fixtures/claude-code/clean-multi-tool-2-models.jsonl" };
const UNPRICED = { source: "claude-code", path: "test/fixtures/claude-code/unpriced-unknown-model.jsonl" };

async function modelFor(source: string, path: string): Promise<ReceiptModel> {
  const session = await loadById(source, path);
  if (!session) {
    throw new Error(`failed to load ${path}`);
  }
  return buildReceiptModel(session);
}

/** Short display strings a block puts on both renderers verbatim (skips wrapped/centered/chrome that the layouts reflow). */
function checkableLabels(b: Block): string[] {
  switch (b.kind) {
    case "masthead":
      return [b.text];
    case "columnHeader":
      return [b.item, b.qty, b.amt];
    case "row":
      return b.columns ? [b.label] : [b.label, b.value];
    case "wasteRow":
      return [b.label];
    case "total":
      return [b.label];
    case "note":
      return [b.text];
    case "barcode":
      return [b.pattern];
    default:
      return [];
  }
}

describe("SPEC-0020 R3 — exact-wording honesty battery holds in every template", () => {
  it.each([...TEMPLATE_NAMES])("priced (%s): validateReceiptBlocks is clean and carries the exact strings", async (template) => {
    const model = await modelFor(PRICED.source, PRICED.path);
    const { blocks } = buildReceiptView(model, template);
    expect(validateReceiptBlocks(blocks, model)).toEqual([]);
    // the methodology brief is byte-equal (block level), and the price-delta note renders verbatim (one line) in both mediums.
    expect(blocks.some((b) => b.kind === "footnote" && b.text === METHODOLOGY_BRIEF)).toBe(true);
    expect(renderReceipt(model, { color: false, template })).toContain(PRICE_DELTA_NOTE);
    expect(renderReceiptSvg(model, { template })).toContain(PRICE_DELTA_NOTE);
  });

  it.each([...TEMPLATE_NAMES])("unpriced (%s): zero `$` bytes in blocks and in both renders", async (template) => {
    const model = await modelFor(UNPRICED.source, UNPRICED.path);
    const { blocks } = buildReceiptView(model, template);
    expect(validateReceiptBlocks(blocks, model)).toEqual([]);
    expect(renderReceipt(model, { color: false, template }).includes("$")).toBe(false);
    expect(renderReceiptSvg(model, { template }).includes("$")).toBe(false);
  });

  it("validateReceiptBlocks has teeth: a paraphrased methodology and an injected `$` are caught", async () => {
    const priced = await modelFor(PRICED.source, PRICED.path);
    const tampered = buildReceiptView(priced, "classic").blocks.map((b) =>
      b.kind === "footnote" ? { ...b, text: "roughly how we did it" } : b,
    );
    expect(validateReceiptBlocks(tampered, priced).map((v) => v.code)).toContain("missing-methodology");

    const unpriced = await modelFor(UNPRICED.source, UNPRICED.path);
    const leaked = [...buildReceiptView(unpriced, "classic").blocks, { kind: "note", text: "sneaky $9.99" } as Block];
    expect(validateReceiptBlocks(leaked, unpriced).map((v) => v.code)).toContain("dollar-in-unpriced");
  });
});

describe("SPEC-0020 R3 — numbers equal classic to the cent", () => {
  it("classic and grocery report the identical TOTAL", async () => {
    const model = await modelFor(PRICED.source, PRICED.path);
    const totalOf = (t: TemplateName): string => {
      const total = buildReceiptView(model, t).blocks.find((b) => b.kind === "total");
      return total?.kind === "total" ? total.value : "";
    };
    expect(totalOf("grocery")).toBe(totalOf("classic"));
    expect(totalOf("datavis")).toBe(totalOf("classic"));
    expect(totalOf("classic")).toBe("$0.18");
  });
});

describe("SPEC-0020 Design — grocery 50-char column math", () => {
  it("every emitted grocery line is <= 50 chars, even with a pathological tool name", async () => {
    const base = await modelFor(PRICED.source, PRICED.path);
    const model: ReceiptModel = {
      ...base,
      toolRows: [{ tool: "a-really-long-tool-name-that-blows-past-the-item-column", usd: 0.05, tokens: base.toolRows[0].tokens, callCount: 3 }],
    };
    for (const line of renderReceiptLines(model, { color: false, template: "grocery" })) {
      expect([...line].length).toBeLessThanOrEqual(RECEIPT_WIDTH);
    }
  });

  it("groceryLine truncates an over-long ITEM with `…` and pins the QTY/AMT columns", () => {
    const line = groceryLine("x".repeat(60), "3", "$0.05");
    expect([...line].length).toBe(50);
    // ITEM occupies cols 1-28 and ends with the ellipsis; AMT ends at col 50.
    expect([...line].slice(0, 28).join("")).toBe("x".repeat(27) + "…");
    expect(line.endsWith("$0.05")).toBe(true);
  });

  it("groceryLine caps oversized QTY/AMT too, so a huge token count can never overflow 50 chars", () => {
    const line = groceryLine("Read", "123456789", "1,234,567,890 tok");
    expect([...line].length).toBe(50);
  });

  it("the column header lands QTY in cols 30-37 and AMT in cols 39-50", () => {
    const header = groceryLine("ITEM", "QTY", "AMT");
    expect([...header].length).toBe(50);
    expect(header.slice(0, 28)).toBe("ITEM".padEnd(28));
    expect(header.slice(29, 37)).toBe("QTY".padStart(8));
    expect(header.slice(38, 50)).toBe("AMT".padStart(12));
  });
});

describe("SPEC-0020 — block parity: terminal and SVG consume the identical block list", () => {
  it.each([...TEMPLATE_NAMES])("(%s) every value-bearing block appears in both renderers", async (template) => {
    const model = await modelFor(PRICED.source, PRICED.path);
    const { blocks } = buildReceiptView(model, template);
    // determinism: the same model + template yields the identical list every time.
    expect(buildReceiptView(model, template).blocks).toEqual(blocks);
    const terminal = renderReceipt(model, { color: false, template });
    const svg = renderReceiptSvg(model, { template });
    for (const block of blocks) {
      for (const label of checkableLabels(block)) {
        expect(terminal).toContain(label);
        expect(svg).toContain(label);
      }
    }
  });
});

describe("SPEC-0020 — barcode determinism", () => {
  it("the same sessionId yields the identical pipe pattern; distinct ids differ", () => {
    const idA = "test/fixtures/claude-code/clean-multi-tool-2-models.jsonl";
    const idB = "test/fixtures/claude-code/loop-bash-5x.jsonl";
    expect(barcodePattern(sessionToken(idA))).toBe(barcodePattern(sessionToken(idA)));
    expect(sessionToken(idA)).not.toBe(sessionToken(idB));
    // 8 groups, each 1-4 pipes, space-joined — never leaks the id bytes themselves.
    const pattern = barcodePattern(sessionToken(idA));
    expect(pattern.split(" ")).toHaveLength(8);
    expect(/^[| ]+$/.test(pattern)).toBe(true);
  });
});

describe("SPEC-0020 R1/R2 — CLI surface", () => {
  function capture(): { out: string[]; err: string[]; restore: () => void } {
    const out: string[] = [];
    const err: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((s: string) => (out.push(String(s)), true)) as typeof process.stdout.write;
    process.stderr.write = ((s: string) => (err.push(String(s)), true)) as typeof process.stderr.write;
    const saved = process.env.AIRECEIPTS_TELEMETRY;
    process.env.AIRECEIPTS_TELEMETRY = "off";
    return {
      out,
      err,
      restore: () => {
        process.stdout.write = origOut;
        process.stderr.write = origErr;
        if (saved === undefined) delete process.env.AIRECEIPTS_TELEMETRY;
        else process.env.AIRECEIPTS_TELEMETRY = saved;
      },
    };
  }

  it("R1: an unknown --template exits 1 and lists the valid names", async () => {
    const cap = capture();
    try {
      const code = await main(["--template", "fancy"]);
      expect(code).toBe(1);
      const message = cap.err.join("");
      expect(message).toContain('unknown template "fancy"');
      for (const name of TEMPLATE_NAMES) {
        expect(message).toContain(name);
      }
    } finally {
      cap.restore();
    }
  });

  it("R2: `templates` lists every template with a live preview render", async () => {
    const cap = capture();
    try {
      const code = await main(["templates"]);
      expect(code).toBe(0);
      const listing = cap.out.join("");
      for (const name of TEMPLATE_NAMES) {
        expect(listing).toContain(name);
      }
      // previews are RENDERED from the fixture, not prose: grocery's TXN# and datavis's bar legend show up.
      const preview = previewModel();
      expect(listing).toContain(`TXN #${sessionToken(preview.sessionId)}`);
      expect(listing).toContain("[");
    } finally {
      cap.restore();
    }
  });
});
