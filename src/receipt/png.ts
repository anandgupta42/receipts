// SPEC-0012 R3-R5: --png rasterizes the SAME shared SVG (svg.ts) via
// @resvg/resvg-js — never a third independent renderer. Fixed pixel
// dimensions are the SVG's fixed logical WIDTH (640) scaled by PNG_SCALE, so
// every --png receipt lands at one deterministic pixel width.
//
// R4 determinism note: only the input SVG stays byte-deterministic
// (SPEC-0003 R1, golden-gated) — PNG *pixel* bytes are NOT claimed equal
// across platforms (rasterizer/font-hinting differences are real, per R4's
// explicit non-goal). Cross-platform stability instead comes from pinning
// the rasterizer version (`@resvg/resvg-js` in package.json's `dependencies`,
// promoted from devDependencies per R2's passed gate — see
// docs/spikes/spec-0012-png.md and this spec's Validation section).
import { Resvg } from "@resvg/resvg-js";
import { WIDTH } from "./svg.js";

/** R3: scale applied to the SVG's fixed 640px logical width (2x ≈ 192 effective DPI against a 96 DPI logical baseline). */
export const PNG_SCALE = 2;

/** Fixed pixel width every `--png` receipt renders at (R3; single-receipt only — compare is deferred, R5). */
export const PNG_WIDTH = WIDTH * PNG_SCALE;

/** Rasterize an SVG string (from `renderReceiptSvg`) to PNG bytes at the fixed R3 width. */
export function rasterizeSvgToPng(svg: string): Buffer {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: PNG_WIDTH } });
  return resvg.render().asPng();
}
