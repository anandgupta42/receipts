#!/usr/bin/env node
// Guards the landing page (site/index.html) against the two desktop defects that
// slipped past the first build:
//   1. Display type rendering enormously oversized  -> unbounded/loosely-capped
//      viewport-unit font-size.
//   2. A grey void / horizontal blow-out at desktop -> a CSS grid whose implicit
//      `auto` track grows to a nowrap child's max-content width.
// Pure string/regex checks on the committed HTML — no browser, no deps. Exits
// non-zero with a specific message on any violation.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolve(here, "..", "site", "index.html");
const html = readFileSync(htmlPath, "utf8");

const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/i);
if (!styleMatch) {
  console.error("check-landing-css: no <style> block found in site/index.html");
  process.exit(1);
}
const css = styleMatch[1];
const errors = [];

// Sane ceiling for any display/text size, in px, at any viewport width.
const MAX_FONT_PX = 72;

// Every font-size declaration must resolve to <= MAX_FONT_PX at every width.
// That means: a bare px value <= MAX_FONT_PX, or a clamp() whose MAX arg is a px
// value <= MAX_FONT_PX. A font-size that uses a viewport unit (vw/vh/vmin/vmax)
// without a px clamp ceiling is unbounded and rejected.
const fontDecls = [...css.matchAll(/font-size\s*:\s*([^;}]+)[;}]/gi)].map((m) =>
  m[1].trim()
);
for (const value of fontDecls) {
  const clamp = value.match(/clamp\(\s*([^,]+?)\s*,\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/i);
  if (clamp) {
    const max = clamp[3].trim();
    const px = max.match(/^([\d.]+)px$/);
    if (!px) {
      errors.push(`font-size clamp() has a non-px MAX ("${max}") in "${value}" — the upper bound must be a fixed px so it cannot grow with the viewport.`);
    } else if (parseFloat(px[1]) > MAX_FONT_PX) {
      errors.push(`font-size clamp() MAX ${px[1]}px exceeds the ${MAX_FONT_PX}px display ceiling in "${value}".`);
    }
    if (/\b[\d.]+v(w|h|min|max)\b/i.test(max)) {
      errors.push(`font-size clamp() MAX uses a viewport unit ("${max}") — the ceiling must be a fixed px in "${value}".`);
    }
    continue;
  }
  if (/\b[\d.]+v(w|h|min|max)\b/i.test(value)) {
    errors.push(`font-size "${value}" uses a viewport unit without a clamp() px ceiling — this is the unbounded-display bug.`);
    continue;
  }
  const px = value.match(/^([\d.]+)px$/);
  if (px && parseFloat(px[1]) > MAX_FONT_PX) {
    errors.push(`font-size ${px[1]}px exceeds the ${MAX_FONT_PX}px display ceiling.`);
  }
}

// Any CSS grid must declare grid-template-columns. A grid without it falls back
// to a single implicit `auto` track that grows to its widest (nowrap) child's
// max-content width, blowing the page out horizontally — the grey-void defect.
// Match ANY rule block whose body contains display:grid — including bare element
// selectors like `main{...}` or `section{...}`, not just class/id selectors — so
// a grid without grid-template-columns cannot slip through under a tag selector.
const gridBlocks = [...css.matchAll(/([^{}]+?)\s*\{([^{}]*display\s*:\s*grid[^{}]*)\}/gi)];
for (const [, selector, body] of gridBlocks) {
  if (!/grid-template-columns\s*:/i.test(body) && !/grid-template\s*:/i.test(body)) {
    errors.push(`grid selector "${selector.trim()}" declares display:grid without grid-template-columns — add "grid-template-columns:minmax(0,1fr)" (or explicit tracks) so a nowrap child cannot blow out the layout.`);
  }
}

if (errors.length) {
  console.error("check-landing-css: FAIL");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log(`check-landing-css: OK (${fontDecls.length} font-size decls, ${gridBlocks.length} grid block(s) checked; display ceiling ${MAX_FONT_PX}px)`);
