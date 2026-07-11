// SPEC-0034 R2 — the drawn samosa glyph, once, for every graphical surface.
// Unicode ships no samosa codepoint (see the spec's Purpose); this is the
// real shape instead of a mislabeled dumpling (U+1F95F). HTML surfaces (already
// themed via CSS custom properties / prefers-color-scheme) draw it with
// `currentColor` so it inherits the surrounding text color for free — no
// light/dark duplication needed. SPEC-0055 removed the glyph from the receipt
// SVG exporter (the card is plain text everywhere); the remaining consumers are
// the clickable HTML surfaces, and the static site copies are pinned to PATH
// byte-for-byte by test/receipt/svg.test.ts.
// SPEC-0078 R5 — the "hot & fresh" redesign, maintainer-picked: crimped pastry
// base + steam wisps, replacing the earlier face-like marks.
const PATH =
  '<path d="M22 10 L38.5 39.5 Q40 42 37 42 H7 Q4 42 5.5 39.5 Z"/>' +
  '<path d="M9.5 37 q2.2 -2.8 4.4 0 t4.4 0 t4.4 0 t4.4 0 t4.4 0 t4.4 0"/>' +
  '<path d="M32 12 q3 -3 1 -6"/>' +
  '<path d="M38 17 q3 -3 1 -6"/>';

/** `currentColor` markup for HTML surfaces (artifact page, site footer, samosa page). */
export function samosaGlyphMarkup(size = 16): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">` +
    `<g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">${PATH}</g>` +
    "</svg>"
  );
}
