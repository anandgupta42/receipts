// Hostile fixture battery: ugly-but-valid Claude Code inputs that previously
// escaped visual coverage. Goldens verify the bytes; these assertions pin the
// fixture intent and the terminal width invariant.
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/index.js";
import { TEMPLATE_NAMES, validateReceiptBlocks } from "../../src/receipt/blocks.js";
import { buildReceiptView } from "../../src/receipt/present.js";
import { RECEIPT_WIDTH, renderReceiptLines } from "../../src/receipt/render.js";
import { renderReceiptSvg } from "../../src/receipt/svg.js";
import { buildReceiptModel, type ReceiptModel } from "../../src/receipt/model.js";

const HOSTILE_FIXTURES = [
  "test/fixtures/claude-code/hostile-long-mcp-tool-name.jsonl",
  "test/fixtures/claude-code/hostile-markup-title.jsonl",
  "test/fixtures/claude-code/hostile-huge-numbers.jsonl",
  "test/fixtures/claude-code/hostile-unicode-title.jsonl",
  "test/fixtures/claude-code/hostile-empty-valid.jsonl",
  "test/fixtures/claude-code/hostile-100-tool-variety.jsonl",
] as const;

async function modelFor(path: string): Promise<ReceiptModel> {
  const session = await loadById("claude-code", path);
  if (!session) {
    throw new Error(`failed to load ${path}`);
  }
  return buildReceiptModel(session);
}

describe("hostile Claude Code fixture battery", () => {
  it.each(HOSTILE_FIXTURES)("%s renders honestly through every template and keeps terminal lines <= 50 chars", async (path) => {
    const model = await modelFor(path);

    for (const template of TEMPLATE_NAMES) {
      const { blocks } = buildReceiptView(model, template);
      expect(validateReceiptBlocks(blocks, model), `${path} ${template}`).toEqual([]);

      const lines = renderReceiptLines(model, { color: false, template });
      for (const [index, line] of lines.entries()) {
        expect([...line].length, `${path} ${template} line ${index + 1}: ${line}`).toBeLessThanOrEqual(RECEIPT_WIDTH);
      }

      const svg = renderReceiptSvg(model, { template });
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain('aria-label="aireceipts cost receipt"');
    }
  });

  it("pins the hostile cases to the maintainer review promise", async () => {
    const longMcp = await modelFor("test/fixtures/claude-code/hostile-long-mcp-tool-name.jsonl");
    expect(longMcp.toolRows.some((row) => row.tool === "mcp__claude-in-chrome__browser_batch")).toBe(true);

    const huge = await modelFor("test/fixtures/claude-code/hostile-huge-numbers.jsonl");
    expect(huge.totalTokens.total).toBeGreaterThan(1_000_000_000);
    expect(huge.totalUsd).not.toBeNull();
    expect(huge.totalUsd as number).toBeGreaterThan(10_000);

    const unicode = await modelFor("test/fixtures/claude-code/hostile-unicode-title.jsonl");
    expect(unicode.title).toContain("🚀");
    expect(unicode.title).toContain("字");

    const empty = await modelFor("test/fixtures/claude-code/hostile-empty-valid.jsonl");
    expect(empty.toolRows).toEqual([]);
    expect(empty.totalTokens.total).toBe(0);

    const variety = await modelFor("test/fixtures/claude-code/hostile-100-tool-variety.jsonl");
    expect(variety.toolRows.length).toBeGreaterThanOrEqual(100);
  });

  it("escapes markup-shaped titles in SVG text instead of emitting tags", async () => {
    const model = await modelFor("test/fixtures/claude-code/hostile-markup-title.jsonl");
    const svg = renderReceiptSvg(model, { template: "classic" });
    expect(svg).toContain("Review &lt;receipt");
    expect(svg).toContain("&amp; escape");
    expect(svg).not.toContain("<receipt");
  });
});
