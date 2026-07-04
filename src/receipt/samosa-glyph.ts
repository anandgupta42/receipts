// SPEC-0034 R2 — the drawn samosa glyph, once, for every graphical surface.
// Unicode ships no samosa codepoint (see the spec's Purpose); this is the
// real shape instead of a mislabeled dumpling (U+1F95F). HTML surfaces (already themed via
// CSS custom properties / prefers-color-scheme) draw it with `currentColor`
// so it inherits the surrounding text color for free — no light/dark
// duplication needed there. The receipt SVG exporter is the one surface that
// cannot use `currentColor`: resvg (our own --png engine) renders CSS
// var()/currentColor as black, so it gets a literal-hex variant selected by
// theme name (fixed colors, matching the site's wordmark treatment).
const PATH =
  '<path d="M24 5 L43 39 Q44.5 41.5 41.5 41.5 H6.5 Q3.5 41.5 5 39 Z"/>' +
  '<path d="M17 29 q3 2.5 7 0"/>' +
  '<path d="M21 20 l3 -3 3 3"/>';

/** `currentColor` markup for HTML surfaces (artifact page, site footer, samosa page). */
export function samosaGlyphMarkup(size = 16): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">` +
    `<g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">${PATH}</g>` +
    "</svg>"
  );
}

/** Fixed stroke colors matching the site's wordmark treatment — design-supplied, not derived from the receipt's own theme inks. */
export const SAMOSA_STROKE_LIGHT = "#1f2328";
export const SAMOSA_STROKE_DARK = "#e6edf3";

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Literal-hex `<g>` fragment for the receipt SVG exporter (never
 * `currentColor` — resvg renders that black). `x`,`y` is the top-left of a
 * `size`×`size` box; the 0..48 viewBox is scaled to fit.
 */
export function samosaGlyphGroup(x: number, y: number, size: number, stroke: string): string {
  const scale = round(size / 48);
  return (
    `<g transform="translate(${round(x)} ${round(y)}) scale(${scale})" fill="none" stroke="${stroke}" ` +
    `stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">${PATH}</g>`
  );
}
