// SPEC-0077 R2/R3 — the shareable social card. A NEW, fixed 1200×630 landscape
// renderer (the OG/Twitter ratio), distinct from the tall 640-wide receipt
// (`svg.ts`): it EXECUTES the maintainer-reviewed mockup committed at
// `docs/spikes/spec-0077-receipt-cards-design.html` (the "Unit card" layout —
// total · agent/session meta · cache · cheaper-model on the left; model-mix bar ·
// dot-leader tool line-items on the right). It reuses the receipt's SVG
// primitives (`textEl`/`leaderEl`/`n`/`esc`/`charW`, the `Theme` contract) so the
// two surfaces share one escaping/formatting idiom, but the card carries the
// mockup's own committed "paper" palette (cream + teal), which the receipt's
// blue/white `THEMES` do not express — see `CARD_THEMES`. Deterministic bytes,
// golden-gated (I5). The card is ALWAYS sanitized (R4): it is projected from a
// fixed field set and NEVER reads `model.title` / repo / branch / project / paths.
import { formatDateUtc, formatInt, formatShortTokens, formatUsd } from "./format.js";
import type { ReceiptModel } from "./model.js";
import { cacheServedPct, priceDeltaParts } from "./present.js";
import { FONT_STACK, THEMES, charW, escAttr, leaderEl, n, textEl } from "./svg.js";
import type { Theme, ThemeName } from "./svg.js";

// --- View-model (R2) ---------------------------------------------------------

/** One model-mix slice on the card: the sanitized model string + its token share (0..1). */
export interface CardModelMixEntry {
  model: string;
  tokenShare: number;
}

/** One tool line-item on the card. `usd` is `null` when no contributing turn priced (I2 — render tokens, never a fabricated `$`). */
export interface CardToolRow {
  tool: string;
  usd: number | null;
  tokens: number;
  callCount: number;
}

/** The labeled cheaper-model arithmetic (SPEC-0059), reused verbatim from `priceDeltaParts`. Session card only (R2). */
export interface CardCheaperModel {
  label: string;
  value: string;
}

/**
 * SPEC-0077 R2 — the single view-model `renderCardSvg` consumes, built two ways
 * (`buildSessionCardModel` here; `buildPrCardModel` in a later PR-scope task).
 * `scopeLabel` is a FIXED non-title string (agent + date for a session), NEVER
 * the prompt-derived session title (R4).
 */
export interface CardModel {
  scope: "session" | "pr";
  scopeLabel: string;
  /** `null` when nothing priced — the headline renders tokens, zero `$` bytes (I2). */
  totalUsd: number | null;
  /** True when the headline `$` is a lower bound — renders the `≥` floor marker (I2). */
  floored: boolean;
  tokens: number;
  /** Ordered desc by token share (as `ReceiptModel.modelMix` already is). Empty for Cursor's degraded mode. */
  modelMix: CardModelMixEntry[];
  /** Ordered desc by cost (as `ReceiptModel.toolRows` already is). */
  toolRows: CardToolRow[];
  /** `"85"` etc. from `cacheServedPct`; `undefined` when no cache reads / no per-turn usage. */
  cacheServedPct?: string;
  /** Session card only (R2 omits it on the PR card — an aggregate repricing lacks per-atom provenance). */
  cheaperModel?: CardCheaperModel;
  sessionCount: number;
  subagentCount: number;
  /** Contributor roles (PR scope); empty for a session. */
  roles: string[];
}

/** `Claude Code · Jun 18 2026` — the fixed session scope label (R2/R4: agent + date, never the title). */
function sessionScopeLabel(model: ReceiptModel): string {
  const date = model.startedAtMs !== undefined ? formatDateUtc(model.startedAtMs) : "date unknown";
  return `${model.agentLabel} · ${date}`;
}

/**
 * SPEC-0077 R2 — project a per-session `ReceiptModel` onto the card view-model.
 * Sanitized by construction: `title`, repo, branch, project, and paths are never
 * read. The cheaper-model line reuses the SPEC-0059 arithmetic (`priceDeltaParts`)
 * unchanged; the cache % is `cacheServedPct` over `totalTokens` (not the USD
 * cache field).
 */
export function buildSessionCardModel(model: ReceiptModel): CardModel {
  const cheaper = priceDeltaParts(model);
  const tokens = model.unpriceable ? model.sessionTotalTokens.total : model.totalTokens.total;
  return {
    scope: "session",
    scopeLabel: sessionScopeLabel(model),
    totalUsd: model.totalUsd,
    // A priced total that the adapter flagged as a cache-tier lower bound gets the `≥` marker (I2).
    floored: model.totalUsd !== null && model.costLowerBoundCacheTier,
    tokens,
    modelMix: model.modelMix.map((m) => ({ model: m.model, tokenShare: m.tokenShare })),
    toolRows: model.toolRows.map((r) => ({ tool: r.tool, usd: r.usd, tokens: r.tokens.total, callCount: r.callCount })),
    ...(model.unpriceable ? {} : { cacheServedPct: cacheServedPct(model.totalTokens) }),
    ...(cheaper ? { cheaperModel: cheaper } : {}),
    sessionCount: 1,
    subagentCount: model.subagents?.count ?? 0,
    roles: [],
  };
}

// --- Palette (the mockup's committed "paper" theme; R3) ----------------------
// The card commits to the design source's cream-paper + teal palette, which the
// receipt's blue/white `THEMES` do not express. It still conforms to the shared
// `Theme` contract (card/ink/muted/rule/accent/flag) and reuses `THEMES[..].flag`
// so the two surfaces share one theming shape, keyed by the same `ThemeName`.
export const CARD_THEMES: Record<ThemeName, Theme> = {
  light: { card: "#F7F5F0", ink: "#1B1A16", muted: "#736F64", rule: "#CDCABC", accent: "#177A61", flag: THEMES.light.flag },
  dark: { card: "#14181C", ink: "#EBE8DF", muted: "#8E938F", rule: "#2C3237", accent: "#48C6A0", flag: THEMES.dark.flag },
};

// --- Geometry (fixed logical px; the card never reflows its 630 height) -------
const CARD_W = 1200;
const CARD_H = 630;
const PAD_X = 64;
const LEFT = PAD_X;
const RIGHT = CARD_W - PAD_X; // 1136
const HEAD_BASE = 74;
const HEAD_RULE_Y = 102;
const BODY_TOP = 130;
const FOOT_RULE_Y = 558;
const FOOT_BASE = 586;

// Left column.
const TOTAL_LAB_BASE = BODY_TOP + 18; // 148
const TOTAL_BASE = TOTAL_LAB_BASE + 96; // 244
const SUB1_BASE = TOTAL_BASE + 42; // 286
const SUB_LINE_STEP = 28; // baseline step between wrapped meta lines (was SUB2_BASE − SUB1_BASE)
const SUB_MAX_W = 546; // COL_R (630) − LEFT (64) − 20 gutter — keep left meta clear of the right tool column
const FACTS_BOTTOM = FOOT_RULE_Y - 26; // 532 (baseline of the lowest fact)

// Right column.
const COL_R = 630;
const MIXLAB_BASE = BODY_TOP + 14; // 144
const BAR_TOP = 158;
const BAR_H = 22;
const LEGEND_BASE = BAR_TOP + BAR_H + 30; // 210
const ITEMS_TOP = LEGEND_BASE + 46; // 256
const ROW_STEP = 34;
const MAX_ITEMS = 5;

// Type sizes.
const SZ_BRAND = 25;
const SZ_SCOPE = 22;
const SZ_TOTAL_LAB = 15;
const SZ_TOTAL = 108;
const SZ_SUB = 21;
const SZ_SUB_DIM = 18;
const SZ_FACT = 20;
const SZ_FACT_NOTE = 14;
const SZ_MIXLAB = 16;
const SZ_LEGEND = 16;
const SZ_ITEM = 22;
const SZ_FOOT = 17;

const THINKING_REPLY = "(thinking/reply)";
const BRAND = "AIRECEIPTS";
const FOOT_LEFT = "local · npx aireceipts-cli";
const FOOT_RIGHT = "proof, not vibes";

/** A dashed rule spanning the content width (the receipt idiom, landscape). */
function dashedRule(y: number, rule: string): string {
  return `<line x1="${n(LEFT)}" y1="${n(y)}" x2="${n(RIGHT)}" y2="${n(y)}" stroke="${rule}" stroke-width="1.5" stroke-dasharray="5 5"/>`;
}

/**
 * Positional model-mix colours: the dominant model (index 0) is ink, the
 * smallest/most-economical (last) is teal (accent), any middle models are muted
 * — reproducing the mockup's opus→ink, sonnet→muted, haiku→teal reading without
 * hard-coding model families (R3, "ink-default + teal for economical parts").
 */
function mixColors(count: number, p: Theme): string[] {
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [p.ink];
  }
  return Array.from({ length: count }, (_, i) => (i === 0 ? p.ink : i === count - 1 ? p.accent : p.muted));
}

/** The model-mix stacked bar + wrapped legend. Empty `modelMix` (Cursor) renders nothing. */
function mixElements(mix: CardModelMixEntry[], p: Theme): string[] {
  if (mix.length === 0) {
    return [];
  }
  const colors = mixColors(mix.length, p);
  const els: string[] = [textEl(COL_R, MIXLAB_BASE, "MODEL MIX", { size: SZ_MIXLAB, letterSpacing: 3, fill: p.muted })];

  const gap = 2;
  const barW = RIGHT - COL_R;
  const usable = barW - gap * (mix.length - 1);
  let x = COL_R;
  mix.forEach((m, i) => {
    const w = Math.max(0, m.tokenShare * usable);
    els.push(`<rect x="${n(x)}" y="${n(BAR_TOP)}" width="${n(w)}" height="${n(BAR_H)}" fill="${colors[i]}"/>`);
    x += w + gap;
  });

  // Legend: colour square + `model NN%`, laid left→right, wrapping when a chip
  // would cross the right edge (deterministic; robust for 2–3 models).
  const sq = 13;
  const chipGap = 26;
  let lx = COL_R;
  let ly = LEGEND_BASE;
  mix.forEach((m, i) => {
    const label = `${m.model} ${Math.round(m.tokenShare * 100)}%`;
    const chipW = sq + 8 + label.length * charW(SZ_LEGEND, true);
    if (lx + chipW > RIGHT && lx > COL_R) {
      lx = COL_R;
      ly += 24;
    }
    els.push(`<rect x="${n(lx)}" y="${n(ly - sq + 2)}" width="${n(sq)}" height="${n(sq)}" rx="2" fill="${colors[i]}"/>`);
    els.push(textEl(lx + sq + 8, ly, label, { size: SZ_LEGEND, fill: p.muted }));
    lx += chipW + chipGap;
  });
  return els;
}

/** Fold `toolRows` to at most `MAX_ITEMS` display rows: the tail collapses into one faint `+ N more` roll-up summing the remainder. */
interface CardItem {
  label: string;
  value: string;
  faint: boolean;
}

function itemAmount(usd: number | null, tokens: number): string {
  return usd !== null ? `$${formatUsd(usd)}` : `${formatInt(tokens)} tok`;
}

function toolItems(rows: CardToolRow[]): CardItem[] {
  if (rows.length <= MAX_ITEMS) {
    return rows.map((r) => ({ label: r.tool, value: itemAmount(r.usd, r.tokens), faint: r.tool === THINKING_REPLY }));
  }
  const shown = rows.slice(0, MAX_ITEMS - 1);
  const rest = rows.slice(MAX_ITEMS - 1);
  const items: CardItem[] = shown.map((r) => ({ label: r.tool, value: itemAmount(r.usd, r.tokens), faint: r.tool === THINKING_REPLY }));
  // The roll-up shows a `$` only when every folded row priced (else tokens, I2).
  const allPriced = rest.every((r) => r.usd !== null);
  const restUsd = rest.reduce((s, r) => s + (r.usd ?? 0), 0);
  const restTokens = rest.reduce((s, r) => s + r.tokens, 0);
  items.push({
    label: `+ ${rest.length} more`,
    value: allPriced ? `$${formatUsd(restUsd)}` : `${formatInt(restTokens)} tok`,
    faint: true,
  });
  return items;
}

/** One dot-leader tool line-item (label left, dotted leader, value flush right) — the receipt row idiom in the card's larger type. */
function itemRow(item: CardItem, baseline: number, p: Theme): string[] {
  const fill = item.faint ? p.muted : p.ink;
  const labelEndX = COL_R + item.label.length * charW(SZ_ITEM);
  const valueStartX = RIGHT - item.value.length * charW(SZ_ITEM);
  const els = [
    textEl(COL_R, baseline, item.label, { size: SZ_ITEM, fill }),
    textEl(RIGHT, baseline, item.value, { size: SZ_ITEM, fill, anchor: "end" }),
  ];
  const leaderStart = labelEndX + 10;
  const leaderEnd = valueStartX - 10;
  if (leaderEnd > leaderStart) {
    els.push(leaderEl(leaderStart, leaderEnd, baseline - 5, p.muted));
  }
  return els;
}

/** The left-column headline: `≥ $X.XX`/`≥ N tok` when floored, `$X.XX` when priced, `N tok` when nothing priced (I2). The `≥` marker applies to the token fallback too — an all-unpriced/incomplete total is a lower bound just as a priced one is. */
function totalText(model: CardModel): string {
  const floor = model.floored ? "≥ " : "";
  if (model.totalUsd === null) {
    return `${floor}${formatInt(model.tokens)} tok`;
  }
  return `${floor}$${formatUsd(model.totalUsd)}`;
}

/**
 * SPEC-0077 R7 — the card's headline figure as a caption string, reused by the
 * share step so the caption's `$<total>` matches the image exactly: `$X.XX`,
 * the `≥ $X.XX` floor marker, or the `N tok` fallback when nothing priced (I2).
 */
export function cardHeadline(model: CardModel): string {
  return totalText(model);
}

/** SPEC-0077 R7 — the pseudo tool label the card renders faint; excluded from a caption's tool count. */
export const CARD_THINKING_REPLY = THINKING_REPLY;

/**
 * Greedily pack ` · `-joined segments into lines no wider than `maxW`, so the
 * left-column meta never bleeds into the right tool column. A single segment
 * that alone exceeds `maxW` still occupies its own line (never split mid-word).
 */
function wrapSegments(segments: string[], sz: number, maxW: number): string[] {
  const cw = charW(sz);
  const lines: string[] = [];
  let cur = "";
  for (const seg of segments) {
    const candidate = cur === "" ? seg : `${cur} · ${seg}`;
    if (cur !== "" && candidate.length * cw > maxW) {
      lines.push(cur);
      cur = seg;
    } else {
      cur = candidate;
    }
  }
  if (cur !== "") {
    lines.push(cur);
  }
  return lines;
}

/**
 * The left meta block: session/subagent counts (+ roles for a PR) wrapped to the
 * left column width, then a dim token count. A single session yields one count
 * line (byte-identical to the pre-wrap layout); a PR's longer counts+roles wrap
 * onto a second line rather than overrunning the tool column.
 */
function subLines(model: CardModel): { countLines: string[]; tokenLine: string } {
  const plural = (n2: number): string => (n2 === 1 ? "" : "s");
  const segments = [`${formatInt(model.sessionCount)} session${plural(model.sessionCount)}`];
  if (model.subagentCount > 0) {
    segments.push(`${formatInt(model.subagentCount)} subagent${plural(model.subagentCount)}`);
  }
  if (model.roles.length > 0) {
    segments.push(model.roles.join(" + "));
  }
  return {
    countLines: wrapSegments(segments, SZ_SUB, SUB_MAX_W),
    tokenLine: `${formatShortTokens(model.tokens)} tokens`,
  };
}

/** The bottom-pinned facts block (cache ✓ line, then the session-only cheaper-model ↘ line + arithmetic note), laid bottom-up. */
function factElements(model: CardModel, p: Theme): string[] {
  const els: string[] = [];
  let y = FACTS_BOTTOM;
  if (model.cheaperModel) {
    els.push(textEl(LEFT, y, "(arithmetic, not a prediction)", { size: SZ_FACT_NOTE, fill: p.muted }));
    y -= 26;
    els.push(textEl(LEFT, y, `↘ ${model.cheaperModel.label} ${model.cheaperModel.value}`, { size: SZ_FACT, fill: p.ink }));
    y -= 32;
  }
  if (model.cacheServedPct !== undefined) {
    els.push(textEl(LEFT + 24, y, `cache served ${model.cacheServedPct}% of input`, { size: SZ_FACT, fill: p.ink }));
    els.push(textEl(LEFT, y, "✓", { size: SZ_FACT, fill: p.accent, weight: 700 }));
  }
  return els;
}

/** A sanitized, factual aria-label — no title/repo/project (R4). */
function ariaLabel(model: CardModel): string {
  const parts = [`aireceipts ${model.scope} card`, model.scopeLabel, `total ${totalText(model)}`];
  if (model.cacheServedPct !== undefined) {
    parts.push(`cache served ${model.cacheServedPct}% of input`);
  }
  return parts.join(", ");
}

/**
 * SPEC-0077 R3 — render one `CardModel` as a self-contained 1200×630 SVG string,
 * light or dark. Deterministic bytes (golden-gated, I5). Font-safe monospace
 * layout; the on-screen/rasterized font is the viewer's/rasterizer's monospace.
 */
export function renderCardSvg(model: CardModel, opts: { theme?: ThemeName } = {}): string {
  const p = CARD_THEMES[opts.theme ?? "light"];
  const els: string[] = [`<rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" fill="${p.card}"/>`];

  // Head: brand + scope, then a tight dashed rule.
  els.push(textEl(LEFT, HEAD_BASE, BRAND, { size: SZ_BRAND, weight: 600, letterSpacing: 6, fill: p.ink }));
  els.push(textEl(RIGHT, HEAD_BASE, model.scopeLabel, { size: SZ_SCOPE, letterSpacing: 1, fill: p.muted, anchor: "end" }));
  els.push(dashedRule(HEAD_RULE_Y, p.rule));

  // Left column: TOTAL label, headline, sub-lines, bottom-pinned facts.
  els.push(textEl(LEFT, TOTAL_LAB_BASE, "TOTAL", { size: SZ_TOTAL_LAB, letterSpacing: 3, fill: p.muted }));
  els.push(textEl(LEFT, TOTAL_BASE, totalText(model), { size: SZ_TOTAL, weight: 600, fill: p.ink }));
  const { countLines, tokenLine } = subLines(model);
  let subY = SUB1_BASE;
  for (const line of countLines) {
    els.push(textEl(LEFT, subY, line, { size: SZ_SUB, fill: p.ink }));
    subY += SUB_LINE_STEP;
  }
  els.push(textEl(LEFT, subY, tokenLine, { size: SZ_SUB_DIM, fill: p.muted }));
  els.push(...factElements(model, p));

  // Right column: model-mix bar + legend, then dot-leader tool line-items.
  els.push(...mixElements(model.modelMix, p));
  toolItems(model.toolRows).forEach((item, i) => {
    els.push(...itemRow(item, ITEMS_TOP + i * ROW_STEP, p));
  });

  // Foot: dashed rule + local/attribution line.
  els.push(dashedRule(FOOT_RULE_Y, p.rule));
  els.push(textEl(LEFT, FOOT_BASE, FOOT_LEFT, { size: SZ_FOOT, fill: p.muted }));
  els.push(textEl(RIGHT, FOOT_BASE, FOOT_RIGHT, { size: SZ_FOOT, fill: p.accent, anchor: "end" }));

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" ` +
    `font-family='${FONT_STACK}' role="img" aria-label="${escAttr(ariaLabel(model))}">` +
    els.join("") +
    `</svg>`
  );
}
