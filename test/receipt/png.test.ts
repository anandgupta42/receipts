// SPEC-0012 R3-R5 smoke tests for the PNG export. NOT golden (R4: PNG pixel
// bytes are not claimed byte-deterministic across platforms) — this file only
// asserts the objective, cross-platform-stable properties: fixed dimensions,
// a non-empty buffer, and a correct PNG signature. The byte-deterministic
// input SVG stays golden-gated by scripts/verify-goldens.mjs, unaffected.
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/index.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { renderReceiptSvg } from "../../src/receipt/svg.js";
import { PNG_SCALE, PNG_WIDTH, rasterizeSvgToPng } from "../../src/receipt/png.js";

const PRICED = { source: "claude-code", path: "test/fixtures/claude-code/clean-multi-tool-2-models.jsonl" };
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function svgHeight(svg: string): number {
  const m = svg.match(/height="([0-9.]+)"/);
  return Number(m![1]);
}

/** IHDR chunk width/height, big-endian u32s starting at byte 16. */
function pngDimensions(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe("rasterizeSvgToPng — R3/R4/R5 smoke", () => {
  it("rasterizes to a valid PNG with the fixed R3 width", async () => {
    const session = await loadById(PRICED.source, PRICED.path);
    if (!session) throw new Error(`failed to load ${PRICED.path}`);
    const model = await buildReceiptModel(session);
    const svg = renderReceiptSvg(model);
    const png = rasterizeSvgToPng(svg);

    expect(png.length).toBeGreaterThan(0);
    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);

    const { width, height } = pngDimensions(png);
    expect(width).toBe(PNG_WIDTH);
    // Height scales with the same fixed factor resvg applies to width (fitTo: mode "width").
    expect(height).toBe(Math.round(svgHeight(svg) * PNG_SCALE));
  });

  it("is not claimed byte-deterministic (R4) — only dimensions/signature are asserted here", async () => {
    const session = await loadById(PRICED.source, PRICED.path);
    if (!session) throw new Error(`failed to load ${PRICED.path}`);
    const model = await buildReceiptModel(session);
    const svg = renderReceiptSvg(model);
    const a = rasterizeSvgToPng(svg);
    const b = rasterizeSvgToPng(svg);
    // Same-machine reruns of the same input are typically byte-identical, but
    // this is NOT the invariant under test (R4 explicitly disclaims it across
    // platforms) — only shape/signature are the contract.
    expect(pngDimensions(a)).toEqual(pngDimensions(b));
  });
});
