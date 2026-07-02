// SPEC-0003: the shareable till-receipt SVG. Formats the SAME shared
// `ReceiptView` the terminal renderer uses (see `present.ts`) into geometry —
// zero new deps, deterministic bytes (golden-gated, I5). Everything a font
// can't be trusted to draw is a shape, never a glyph (R1 font-safety):
// perforation, leader dots, rules, the waste badge, and the LOCAL·DETERMINISTIC
// stamp are all paths/strokes. Text layout is computed on a fixed monospace
// column grid with a +10% glyph-width safety margin so labels and values can
// never collide, whatever monospace the viewer substitutes.
//
// Colours are theme CSS variables *with a concrete hex fallback*
// Literal per-theme hex only — CSS var() (even with fallbacks) renders BLACK in
// resvg (our own --png engine); portability of the share-artifact wins over
// re-theme by swapping one variable, while renderers that don't implement CSS
// custom properties (librsvg, some GitHub image paths) fall back to the hex and
// still render correctly — non-negotiable for "the screenshot IS the
// distribution".
import { compareDeltaLine } from "./compare.js";
import { wrapText } from "./format.js";
import type { ReceiptModel } from "./model.js";
import { buildReceiptView } from "./present.js";
import type { ReceiptView } from "./present.js";

export type ThemeName = "light" | "dark";

export interface Theme {
  card: string;
  ink: string;
  muted: string;
  rule: string;
  accent: string;
  flag: string;
}

/** Lead-authored palette (SPEC-0003 Design). Both pairs clear the R2 ≥4.5 text-vs-card contrast assertion. */
export const THEMES: Record<ThemeName, Theme> = {
  light: { card: "#FFFFFF", ink: "#1B1E22", muted: "#5A6068", rule: "#D8DBD6", accent: "#3947C2", flag: "#B3372E" },
  dark: { card: "#1E2226", ink: "#E8E8E4", muted: "#9AA0A6", rule: "#2E3438", accent: "#8B96F8", flag: "#E0705F" },
};

export interface SvgOptions {
  theme?: ThemeName;
}

/** Themed paint strings (literal hex) resolved once per render and threaded through the layout. */
interface Paints {
  card: string;
  ink: string;
  muted: string;
  rule: string;
  accent: string;
  flag: string;
}

function paintsFor(theme: Theme): Paints {
  return {
    card: theme.card,
    ink: theme.ink,
    muted: theme.muted,
    rule: theme.rule,
    accent: theme.accent,
    flag: theme.flag,
  };
}

// --- Canvas geometry (Design section, all logical px) ------------------------
const WIDTH = 640;
const PAD_X = 32;
const LEFT = PAD_X;
const RIGHT = WIDTH - PAD_X; // 608
const PAD_TOP = 26;
const PAD_BOTTOM = 26;
const ROW_H = 22;
const SECTION_GAP = 10;
const FOOT_LH = 15; // footnote line box
const META_LH = 16;

const FONT_STACK = '"SF Mono","Cascadia Code","JetBrains Mono",Menlo,Consolas,monospace';

// Type sizes.
const SZ_WORDMARK = 15;
const SZ_META = 11.5;
const SZ_BODY = 12.5;
const SZ_TOTAL = 14;
const SZ_FOOT = 10.5;
const SZ_FOOTER = 11;
const SZ_STAMP = 10;

// Monospace advance ≈ 0.6em; the +10% margin is the font-safety tolerance (R1).
const CHAR_RATIO = 0.6;
const GLYPH_SAFETY = 1.1;

// Waste badge + stamp geometry.
const BADGE = 12; // equilateral triangle side
const BADGE_GAP = 4;
const WASTE_LABEL_X = LEFT + BADGE + BADGE_GAP; // label start when a badge prefixes the row
const STAMP_ROTATE = -4;

// Emoji deliberately absent: a glyph outside the monospace face poisons the whole
// text run in resvg-class renderers (tofu). The terminal footer keeps the 🥟.
const FOOTER_TEXT = "aireceipts · local · buy me a samosa";
const STAMP_TEXT = "LOCAL · DETERMINISTIC";

// --- Primitives --------------------------------------------------------------

/** Deterministic number → string: integers bare, else 2dp with trailing zeros stripped. Keeps golden bytes stable across platforms. */
function n(v: number): string {
  if (Number.isInteger(v)) {
    return String(v);
  }
  return String(Math.round(v * 100) / 100);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function charW(size: number, safe = false): number {
  return size * CHAR_RATIO * (safe ? GLYPH_SAFETY : 1);
}

interface TextOpts {
  size: number;
  fill: string;
  anchor?: "start" | "middle" | "end";
  weight?: number;
  letterSpacing?: number;
}

function textEl(x: number, baseline: number, s: string, o: TextOpts): string {
  const anchor = o.anchor ?? "start";
  const weight = o.weight !== undefined ? ` font-weight="${o.weight}"` : "";
  const ls = o.letterSpacing !== undefined ? ` letter-spacing="${n(o.letterSpacing)}"` : "";
  return `<text x="${n(x)}" y="${n(baseline)}" font-size="${n(o.size)}" fill="${o.fill}" text-anchor="${anchor}"${weight}${ls}>${esc(s)}</text>`;
}

/** A dotted leader stroke (never dot glyphs): round-capped dashes in the muted token. */
function leaderEl(x1: number, x2: number, y: number, muted: string): string {
  return `<line x1="${n(x1)}" y1="${n(y)}" x2="${n(x2)}" y2="${n(y)}" stroke="${muted}" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="0.1 7"/>`;
}

// --- Row layout (font-safe column grid, R1/R2) -------------------------------

export interface RowGeometry {
  labelText: string;
  truncated: boolean;
  labelEndX: number;
  valueStartX: number;
  leaderStartX: number;
  leaderEndX: number;
  /** True if, even at +10% glyph width, the label and value would collide. The layout guarantees this is false by truncating with "…". */
  overlapSafe: boolean;
}

/**
 * Compute one row's geometry on the fixed column grid. Labels truncate with "…"
 * before their +10%-width extent could cross value-start−24px, so the leader
 * gap survives any monospace substitution (R1). Pure and exported so the
 * font-safety test drives the real code, not a re-implementation.
 */
export function rowGeometry(labelStartX: number, label: string, value: string, size: number): RowGeometry {
  const cw = charW(size);
  const cwSafe = charW(size, true);
  const valueStartSafe = RIGHT - value.length * cwSafe;
  const maxLabelPx = valueStartSafe - 24 - labelStartX;
  const maxChars = Math.max(1, Math.floor(maxLabelPx / cwSafe));

  let labelText = label;
  let truncated = false;
  if (label.length > maxChars) {
    truncated = true;
    labelText = label.slice(0, Math.max(1, maxChars - 1)) + "…";
  }

  const labelEndX = labelStartX + labelText.length * cw;
  const valueStartX = RIGHT - value.length * cw;
  const labelEndSafe = labelStartX + labelText.length * cwSafe;
  return {
    labelText,
    truncated,
    labelEndX,
    valueStartX,
    leaderStartX: labelEndX + 8,
    leaderEndX: valueStartX - 8,
    overlapSafe: labelEndSafe + 8 > valueStartSafe - 8,
  };
}

interface RowStyle {
  size: number;
  weight?: number;
  labelFill: string;
  valueFill: string;
  labelStartX: number;
  muted: string;
}

function rowElements(label: string, value: string, rowTop: number, style: RowStyle): string[] {
  const g = rowGeometry(style.labelStartX, label, value, style.size);
  const baseline = rowTop + 15;
  const els: string[] = [
    textEl(style.labelStartX, baseline, g.labelText, { size: style.size, weight: style.weight, fill: style.labelFill }),
    textEl(RIGHT, baseline, value, { size: style.size, weight: style.weight, fill: style.valueFill, anchor: "end" }),
  ];
  if (g.leaderEndX > g.leaderStartX) {
    els.push(leaderEl(g.leaderStartX, g.leaderEndX, baseline - 4, style.muted));
  }
  return els;
}

/** 12px equilateral warning triangle (flag fill) with a white "!" — replaces the terminal `⚠` glyph so the marker isn't font-dependent. Centered on `cy`. */
function wasteBadge(cy: number, flag: string): string {
  const cx = LEFT + BADGE / 2;
  const h = (BADGE * Math.sqrt(3)) / 2;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  const tri = `<path d="M${n(cx)} ${n(top)} L${n(cx + BADGE / 2)} ${n(bottom)} L${n(cx - BADGE / 2)} ${n(bottom)} Z" fill="${flag}"/>`;
  const stem = `<line x1="${n(cx)}" y1="${n(top + 3.5)}" x2="${n(cx)}" y2="${n(bottom - 3.5)}" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round"/>`;
  const dot = `<circle cx="${n(cx)}" cy="${n(bottom - 1.5)}" r="0.9" fill="#FFFFFF"/>`;
  return tri + stem + dot;
}

// --- Content layout ----------------------------------------------------------

interface LaidOut {
  els: string[];
  height: number;
}

function footMaxChars(size: number, innerWidth: number): number {
  return Math.max(1, Math.floor(innerWidth / charW(size)));
}

function footnoteLines(text: string, topY: number, innerWidth: number, muted: string, els: string[]): number {
  let y = topY;
  for (const line of wrapText(text, footMaxChars(SZ_FOOT, innerWidth))) {
    els.push(textEl(LEFT, y + 11, line, { size: SZ_FOOT, fill: muted }));
    y += FOOT_LH;
  }
  return y;
}

function layoutContent(view: ReceiptView, p: Paints): LaidOut {
  const els: string[] = [];
  let y = PAD_TOP;

  // Masthead: wordmark + centered meta lines.
  els.push(textEl(WIDTH / 2, y + 14, view.wordmark, { size: SZ_WORDMARK, weight: 700, letterSpacing: 3, anchor: "middle", fill: p.ink }));
  y += 22;
  for (const meta of view.metaLines) {
    els.push(textEl(WIDTH / 2, y + 11, meta, { size: SZ_META, anchor: "middle", fill: p.muted }));
    y += META_LH;
  }
  y += SECTION_GAP;

  // Tool rows.
  for (const row of view.toolRows) {
    els.push(...rowElements(row.label, row.value, y, { size: SZ_BODY, labelFill: p.ink, valueFill: p.ink, labelStartX: LEFT, muted: p.muted }));
    y += ROW_H;
  }

  // Waste rows (value in flag; stuck-loop prefixed with the triangle badge).
  if (view.wasteRows.length > 0) {
    y += SECTION_GAP;
    for (const waste of view.wasteRows) {
      if (waste.kind === "stuck-loop") {
        els.push(wasteBadge(y + 11, p.flag));
        els.push(...rowElements(waste.label, waste.value, y, { size: SZ_BODY, labelFill: p.ink, valueFill: p.flag, labelStartX: WASTE_LABEL_X, muted: p.muted }));
        y += ROW_H;
      } else {
        els.push(...rowElements(waste.label, waste.value, y, { size: SZ_BODY, labelFill: p.ink, valueFill: p.flag, labelStartX: LEFT, muted: p.muted }));
        y += ROW_H - 4;
        els.push(textEl(LEFT + 12, y + 10, waste.detail, { size: SZ_FOOT, fill: p.muted }));
        y += FOOT_LH + 3;
      }
    }
  }

  // TOTAL: full-inner-width rule, then the bold total row.
  y += 6;
  els.push(`<line x1="${n(LEFT)}" y1="${n(y)}" x2="${n(RIGHT)}" y2="${n(y)}" stroke="${p.rule}" stroke-width="1.5"/>`);
  y += 8;
  els.push(...rowElements(view.total.label, view.total.value, y, { size: SZ_TOTAL, weight: 700, labelFill: p.ink, valueFill: p.ink, labelStartX: LEFT, muted: p.muted }));
  y += ROW_H;
  if (view.totalNote) {
    els.push(textEl(LEFT, y + 10, view.totalNote, { size: SZ_FOOT, fill: p.muted }));
    y += FOOT_LH;
  }

  // Footnotes: price-delta (if priced) then the methodology brief.
  if (view.priceDelta) {
    y += SECTION_GAP;
    y = footnoteLines(view.priceDelta, y, RIGHT - LEFT, p.muted, els);
  }
  y += SECTION_GAP;
  y = footnoteLines(view.methodologyBrief, y, RIGHT - LEFT, p.muted, els);

  // Stamp (bottom-right, rotated) then the centered footer 18px below it.
  y += 12;
  els.push(stampElement(y, p.accent));
  const footerBaseline = y + 22 + 18 + SZ_FOOTER;
  els.push(textEl(WIDTH / 2, footerBaseline, FOOTER_TEXT, { size: SZ_FOOTER, anchor: "middle", fill: p.muted }));

  const height = footerBaseline + 6 + PAD_BOTTOM;
  return { els, height };
}

/** The signature stamp: rounded-rect in accent, rotated −4°, uppercase LOCAL · DETERMINISTIC. `topY` is the top of the stamp box. */
function stampElement(topY: number, accent: string): string {
  const boxH = SZ_STAMP + 12;
  const textW = STAMP_TEXT.length * charW(SZ_STAMP) + (STAMP_TEXT.length - 1) * 2;
  const boxW = textW + 24;
  const boxX = RIGHT - boxW;
  const cx = boxX + boxW / 2;
  const cy = topY + boxH / 2;
  const rect = `<rect x="${n(boxX)}" y="${n(topY)}" width="${n(boxW)}" height="${n(boxH)}" rx="4" fill="none" stroke="${accent}" stroke-width="2"/>`;
  const label = textEl(cx, cy + 3.5, STAMP_TEXT, { size: SZ_STAMP, weight: 700, letterSpacing: 2, anchor: "middle", fill: accent });
  return `<g class="stamp" opacity="0.8" transform="rotate(${STAMP_ROTATE} ${n(cx)} ${n(cy)})">${rect}${label}</g>`;
}

// --- Card + document assembly ------------------------------------------------

/** Scalloped perforation as a mask: black circles knock transparent notches into the card's top and bottom edges (the "page-background" shows through, adapting to any host background). Circles r=5, spacing 14px, centered on the edges. */
function perforationMask(idSuffix: string, height: number): string {
  const circles = (cy: number, cls: string): string => {
    let out = `<g class="${cls}">`;
    for (let cx = 7; cx < WIDTH; cx += 14) {
      out += `<circle cx="${n(cx)}" cy="${n(cy)}" r="5" fill="#000000"/>`;
    }
    return out + "</g>";
  };
  return (
    `<mask id="perf-${idSuffix}" maskUnits="userSpaceOnUse" x="-5" y="-5" width="${WIDTH + 10}" height="${n(height + 10)}">` +
    `<rect x="0" y="0" width="${WIDTH}" height="${n(height)}" fill="#FFFFFF"/>` +
    circles(0, "perf-top") +
    circles(height, "perf-bottom") +
    `</mask>`
  );
}

function cardGroup(els: string[], height: number, xOffset: number, idSuffix: string, card: string): string {
  const inner =
    `<defs>${perforationMask(idSuffix, height)}</defs>` +
    `<rect x="0" y="0" width="${WIDTH}" height="${n(height)}" fill="${card}" mask="url(#perf-${idSuffix})"/>` +
    els.join("");
  return `<g transform="translate(${n(xOffset)} 0)">${inner}</g>`;
}



function svgDocument(width: number, height: number, body: string, label: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}" font-family='${FONT_STACK}' role="img" aria-label="${esc(label)}">` +
    body +
    `</svg>`
  );
}

/** Render one receipt as a self-contained SVG string (R1). Deterministic bytes; on-screen font is the viewer's monospace (layout is font-safe). */
export function renderReceiptSvg(model: ReceiptModel, opts: SvgOptions = {}): string {
  const theme = THEMES[opts.theme ?? "light"];
  const p = paintsFor(theme);
  const { els, height } = layoutContent(buildReceiptView(model), p);
  const body = cardGroup(els, height, 0, "0", p.card);
  return svgDocument(WIDTH, height, body, "aireceipts cost receipt");
}

const COMPARE_GUTTER = 24;
const COMPARE_WIDTH = WIDTH * 2 + COMPARE_GUTTER; // 1304

/** Render two receipts side-by-side in one SVG with the factual ratio-only delta line (R3, I6 — no better/worse styling; nothing coloured green/red across cards). */
export function renderCompareSvg(a: ReceiptModel, b: ReceiptModel, opts: SvgOptions = {}): string {
  const theme = THEMES[opts.theme ?? "light"];
  const p = paintsFor(theme);
  const laidA = layoutContent(buildReceiptView(a), p);
  const laidB = layoutContent(buildReceiptView(b), p);
  const cardHeight = Math.max(laidA.height, laidB.height);

  const cards =
    cardGroup(laidA.els, cardHeight, 0, "a", p.card) + cardGroup(laidB.els, cardHeight, WIDTH + COMPARE_GUTTER, "b", p.card);

  const deltaTop = cardHeight + 20;
  const deltaEls: string[] = [];
  let y = deltaTop;
  for (const line of wrapText(compareDeltaLine(a, b), footMaxChars(SZ_META, COMPARE_WIDTH - 2 * PAD_X))) {
    deltaEls.push(textEl(COMPARE_WIDTH / 2, y + 11, line, { size: SZ_META, anchor: "middle", fill: p.muted }));
    y += META_LH;
  }
  const height = y + 20;
  const body = cards + deltaEls.join("");
  return svgDocument(COMPARE_WIDTH, height, body, "aireceipts receipt comparison");
}
