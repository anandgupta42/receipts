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
import { buildReceiptView } from "../../src/receipt/present.js";
import { renderReceipt, renderReceiptLines, RECEIPT_WIDTH } from "../../src/receipt/render.js";
import { renderReceiptSvg } from "../../src/receipt/svg.js";
import { previewModel } from "../../src/receipt/preview.js";
import { main } from "../../src/cli/index.js";
import { INSTALL_FOOTER_TEXT, REPOSITORY_DISPLAY } from "../../src/receipt/branding.js";
import { emptyUsage } from "../../src/parse/util.js";

const PRICED = { source: "claude-code", path: "test/fixtures/claude-code/clean-multi-tool-2-models.jsonl" };
const UNPRICED = { source: "claude-code", path: "test/fixtures/claude-code/unpriced-unknown-model.jsonl" };

async function modelFor(source: string, path: string): Promise<ReceiptModel> {
  const session = await loadById(source, path);
  if (!session) {
    throw new Error(`failed to load ${path}`);
  }
  return buildReceiptModel(session);
}

describe("SPEC-0078 R1 receipt provenance", () => {
  it.each([...TEMPLATE_NAMES])("%s ends with centered provenance inside the 50-column contract", async (template) => {
    const model = await modelFor(PRICED.source, PRICED.path);
    const lines = renderReceiptLines(model, { color: false, template });
    const install = lines.findIndex((line) => line.trim() === INSTALL_FOOTER_TEXT);
    const repository = lines.findIndex((line) => line.trim() === REPOSITORY_DISPLAY);
    expect(install).toBeGreaterThan(-1);
    expect(repository).toBe(install + 1);
    expect(lines[repository].trim()).toBe(REPOSITORY_DISPLAY);
    expect(lines.every((line) => [...line].length <= RECEIPT_WIDTH)).toBe(true);
    const svg = renderReceiptSvg(model, { template });
    expect(svg).toContain(REPOSITORY_DISPLAY);
    expect(svg).not.toContain("<a");
    expect(svg.match(/class="stamp"/g) ?? []).toHaveLength(1);
  });

  it("grocery preserves thank-you then barcode before its provenance footer", async () => {
    const model = await modelFor(PRICED.source, PRICED.path);
    const lines = renderReceiptLines(model, { color: false, template: "grocery" });
    const thanks = lines.findIndex((line) => line.includes("THANK YOU FOR VIBING WITH"));
    const barcode = lines.findIndex((line, index) => index > thanks && /^[| ]+$/.test(line.trim()));
    const install = lines.findIndex((line, index) => index > barcode && line.trim() === INSTALL_FOOTER_TEXT);
    const repository = lines.findIndex((line, index) => index > install && line.trim() === REPOSITORY_DISPLAY);
    expect(thanks).toBeGreaterThan(-1);
    expect(barcode).toBeGreaterThan(thanks);
    expect(install).toBeGreaterThan(barcode);
    expect(repository).toBe(install + 1);
  });
});

function footnoteTokens(text: string): string[] {
  return text.split(/\s+/).filter((token) => token.length >= 8);
}

/** Value-bearing display strings a block puts on both renderers; wrapped footnotes are checked token-wise because terminal/SVG line widths differ. */
function checkableValues(b: Block): string[] {
  switch (b.kind) {
    case "masthead":
      return [b.text];
    case "meta":
      return b.lines;
    case "columnHeader":
      return [b.item, b.qty, b.amt];
    case "row":
      return b.columns ? [b.label, b.value, b.columns.qty, b.columns.amt] : [b.label, b.value];
    case "wasteRow":
      return b.detail === undefined ? [b.label, b.value] : [b.label, b.value, b.detail];
    case "total":
      return b.columns ? [b.label, b.value, b.columns.qty, b.columns.amt] : [b.label, b.value];
    case "note":
      return [b.text];
    case "barcode":
      return [b.pattern];
    case "footnote":
      return footnoteTokens(b.text);
    case "footer":
      return [b.text];
    default:
      return [];
  }
}

describe("SPEC-0020 R3 — exact-wording honesty battery holds in every template", () => {
  it.each([...TEMPLATE_NAMES])("priced (%s): validateReceiptBlocks is clean and carries the exact strings", async (template) => {
    const model = await modelFor(PRICED.source, PRICED.path);
    const { blocks } = buildReceiptView(model, template);
    expect(validateReceiptBlocks(blocks, model)).toEqual([]);
    // SPEC-0055: the card carries no methodology footnote — the full methodology
    // is one flag away (`aireceipts --methodology`) and ships in `--json`.
    expect(blocks.some((b) => b.kind === "footnote")).toBe(false);
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

  it("validateReceiptBlocks has teeth: an injected `$` is caught, priced or unpriced", async () => {
    const priced = await modelFor(PRICED.source, PRICED.path);
    const unpriced = await modelFor(UNPRICED.source, UNPRICED.path);
    const leaked = [...buildReceiptView(unpriced, "classic").blocks, { kind: "note", text: "sneaky $9.99" } as Block];
    expect(validateReceiptBlocks(leaked, unpriced).map((v) => v.code)).toContain("dollar-in-unpriced");

    const withFakeDollar = [
      ...buildReceiptView(priced, "classic").blocks,
      { kind: "row", label: "fake surcharge", value: "$123,456.78" },
    ] as Block[];
    expect(validateReceiptBlocks(withFakeDollar, priced).map((v) => v.code)).toContain("untraced-dollar");

    const exactLooking = buildReceiptView(priced, "classic").blocks.map((block) =>
      block.kind === "total" ? { ...block, value: block.value.replace(/^≥ /u, "") } : block,
    );
    expect(validateReceiptBlocks(exactLooking, priced).map((v) => v.code)).toContain("unqualified-dollar");
  });

  it.each([...TEMPLATE_NAMES])("accepts the traced parent+subagent TOTAL on %s", async (template) => {
    const model = await modelFor(PRICED.source, PRICED.path);
    model.subagents = {
      count: 1,
      pricedUsd: 0.03,
      tokensTotal: 100,
      unpricedTokens: emptyUsage(),
      unpricedCount: 0,
      unreadableCount: 0,
    };
    model.priceDelta = null;
    expect(validateReceiptBlocks(buildReceiptView(model, template).blocks, model)).toEqual([]);
  });

  it.each([...TEMPLATE_NAMES])("accepts a qualified child floor caveat on an unpriced-parent %s receipt", async (template) => {
    const model = await modelFor(UNPRICED.source, UNPRICED.path);
    model.subagents = {
      count: 1,
      pricedUsd: 0.03,
      tokensTotal: 100,
      unpricedTokens: emptyUsage(),
      unpricedCount: 0,
      unreadableCount: 0,
    };
    model.caveats.push({
      kind: "subagents-priced-tokens-only",
      text: "1 subagent priced (≥ $0.03) — child floor shown separately; parent session unpriced",
    });
    expect(validateReceiptBlocks(buildReceiptView(model, template).blocks, model)).toEqual([]);
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
    expect(totalOf("classic")).toBe("≥ $0.1764");
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

  it("groceryLine shrinks ITEM/QTY before AMT, so the qualified amount is never truncated", () => {
    const line = groceryLine("Read", "123456789", "1,234,567,890 tok");
    expect([...line].length).toBe(50);
    expect(line).toContain("1,234,567,890 tok");
  });

  it("preserves a large lower-bound amount across every terminal template and SVG", async () => {
    const base = await modelFor(PRICED.source, PRICED.path);
    const usd = 1_234_567.899;
    const model: ReceiptModel = {
      ...base,
      toolRows: [{ ...base.toolRows[0], tool: "Bash", usd }],
      totalUsd: usd,
      priceDelta: null,
    };
    const amount = "≥ $1,234,567.89";

    for (const template of TEMPLATE_NAMES) {
      const lines = renderReceiptLines(model, { color: false, template });
      expect(lines.join("\n")).toContain(amount);
      expect(lines.every((line) => [...line].length <= RECEIPT_WIDTH)).toBe(true);
      expect(renderReceiptSvg(model, { template })).toContain(amount);
    }
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
      for (const value of checkableValues(block).filter((s) => s !== "")) {
        expect(terminal).toContain(value);
        expect(svg).toContain(value);
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
