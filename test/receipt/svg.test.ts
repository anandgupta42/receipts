// SPEC-0003 test matrix for the receipt SVG export. The byte-goldens
// themselves are gated by scripts/verify-goldens.mjs; this file asserts the
// objective design properties (R1 font-safety, R2 geometry/contrast, R3
// compare, R4 field-set parity) and the honesty invariants (I2 zero-`$` in
// tokens-only mode).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/index.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import type { ReceiptModel, ToolRow } from "../../src/receipt/model.js";
import { emptyCostShape } from "../../src/pricing/costShape.js";
import type { TokenUsage } from "../../src/parse/types.js";
import { renderReceiptLines } from "../../src/receipt/render.js";
import { renderReceiptSvg, renderCompareSvg, rowGeometry, THEMES } from "../../src/receipt/svg.js";
import { buildReceiptView } from "../../src/receipt/present.js";
import { samosaGlyphMarkup } from "../../src/receipt/samosa-glyph.js";
import type { ThemeName } from "../../src/receipt/svg.js";

const PRICED = { source: "claude-code", path: "test/fixtures/claude-code/clean-multi-tool-2-models.jsonl" };
const LOOP = { source: "claude-code", path: "test/fixtures/claude-code/loop-bash-5x.jsonl" };
const ROW_H = 22; // must track svg.ts ROW_H
const RIGHT = 608; // card content right edge
const LABEL_X = 32; // card content left edge

async function modelFor(source: string, path: string): Promise<ReceiptModel> {
  const session = await loadById(source, path);
  if (!session) {
    throw new Error(`failed to load ${path}`);
  }
  return buildReceiptModel(session);
}

function usage(total: number): TokenUsage {
  return { input: total, output: 0, cacheRead: 0, cacheCreation: 0, total };
}

function toolRow(tool: string, usd: number | null, total: number, callCount: number): ToolRow {
  return { tool, usd, tokens: usage(total), callCount };
}

/** Minimal ReceiptModel for the synthetic cases (tokens-only, height-linearity). */
function fakeModel(overrides: Partial<ReceiptModel> = {}): ReceiptModel {
  return {
    agentLabel: "Claude Code",
    source: "claude-code",
    sessionId: "s-fake",
    startedAtMs: Date.UTC(2026, 5, 18, 9, 30, 30),
    durationMs: 630000,
    modelMix: [{ model: "claude-opus-4-8", tokens: usage(1000), tokenShare: 1 }],
    toolRows: [toolRow("Bash", 0.05, 1000, 3), toolRow("Edit", 0.05, 800, 2)],
    totalUsd: 0.1,
    totalTokens: usage(1800),
    sessionTotalTokens: usage(1800),
    wasteLines: [],
    caveats: [],
    priceDelta: null,
    methodology: "method",
    priceRowsUsed: [],
    unpriceable: false,
    costShape: emptyCostShape(),
    ...overrides,
  };
}

// --- WCAG contrast (R2) ------------------------------------------------------
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function svgHeight(svg: string): number {
  const m = svg.match(/height="([0-9.]+)"/);
  return Number(m![1]);
}

describe("renderReceiptSvg — R1 determinism", () => {
  it("is byte-identical across renders, both themes", async () => {
    const model = await modelFor(PRICED.source, PRICED.path);
    for (const theme of ["light", "dark"] as ThemeName[]) {
      expect(renderReceiptSvg(model, { theme })).toBe(renderReceiptSvg(model, { theme }));
    }
    // themes differ in bytes (distinct goldens).
    expect(renderReceiptSvg(model, { theme: "light" })).not.toBe(renderReceiptSvg(model, { theme: "dark" }));
  });

  it("is self-contained: no external references", async () => {
    const svg = renderReceiptSvg(await modelFor(PRICED.source, PRICED.path));
    expect(svg).not.toMatch(/xlink:href|<image|href="http/);
    expect(svg.startsWith("<svg")).toBe(true);
  });
});

describe("renderReceiptSvg — I2 tokens-only mode has zero `$` glyphs", () => {
  it("no `$` when nothing priced (no price table matched)", () => {
    const model = fakeModel({
      toolRows: [toolRow("Bash", null, 1200, 3), toolRow("Read", null, 400, 1)],
      totalUsd: null,
      priceDelta: null,
    });
    const svg = renderReceiptSvg(model);
    expect(svg.includes("$")).toBe(false);
    expect(svg).toContain("tok");
  });

  it("no `$` in the Cursor degraded (unpriceable) mode", () => {
    const model = fakeModel({
      unpriceable: true,
      modelMix: [],
      toolRows: [toolRow("edit", null, 0, 4)],
      totalUsd: null,
      priceDelta: null,
    });
    const svg = renderReceiptSvg(model);
    expect(svg.includes("$")).toBe(false);
  });
});

describe("rowGeometry — R1 font-safety on the column grid", () => {
  it("never lets label and value overlap even at +10% glyph width", () => {
    // Realistic longest-ish label + a wide value, plus a pathological long label.
    const cases: Array<[string, string]> = [
      ["≈ re-priced eligible trivial spans", "$1,234.56"],
      ["(thinking/reply)", "$0.03  (2 turns)"],
      ["a-very-long-tool-name-that-would-blow-past-the-value-column", "$12,345.67  (999 calls)"],
    ];
    for (const [label, value] of cases) {
      const g = rowGeometry(LABEL_X, label, value, 12.5);
      expect(g.overlapSafe).toBe(false);
      // when a leader is drawn, it must be a forward segment (start < end).
      if (g.leaderEndX > g.leaderStartX) {
        expect(g.leaderStartX).toBeLessThan(g.leaderEndX);
      }
    }
  });

  it("truncates an over-long label with an ellipsis", () => {
    const g = rowGeometry(LABEL_X, "x".repeat(120), "$0.05  (3 calls)", 12.5);
    expect(g.truncated).toBe(true);
    expect(g.labelText.endsWith("…")).toBe(true);
    expect(g.overlapSafe).toBe(false);
  });

  it("leaves short labels untouched", () => {
    const g = rowGeometry(LABEL_X, "Bash", "$0.05  (3 calls)", 12.5);
    expect(g.truncated).toBe(false);
    expect(g.labelText).toBe("Bash");
  });

  it("fits a complete extreme value inside the card instead of clipping its qualifier", () => {
    const value = `≥ $${"9".repeat(120)}.99`;
    const g = rowGeometry(LABEL_X, "TOTAL", value, 12.5);
    expect(g.valueSize).toBeLessThan(12.5);
    expect(g.valueStartX).toBeGreaterThanOrEqual(LABEL_X);
    expect(g.overlapSafe).toBe(false);
  });
});

describe("renderReceiptSvg — R2 geometry", () => {
  it("has scalloped perforation elements on top and bottom edges", async () => {
    const svg = renderReceiptSvg(await modelFor(PRICED.source, PRICED.path));
    expect(svg).toContain('class="perf-top"');
    expect(svg).toContain('class="perf-bottom"');
    const height = svgHeight(svg);
    // circles centered ON both edges (cy=0 and cy=height).
    expect(svg).toContain('cy="0" r="5"');
    expect(svg).toContain(`cy="${height}" r="5"`);
  });

  it("every priced-row leader has a non-overlapping label/value extent", async () => {
    const model = await modelFor(PRICED.source, PRICED.path);
    const svg = renderReceiptSvg(model);
    // Parse every <text> baseline row: label (anchor start @x=32) vs value (anchor end @x=608).
    const texts = [...svg.matchAll(/<text x="([0-9.]+)" y="([0-9.]+)"[^>]*text-anchor="(start|middle|end)"[^>]*>([^<]*)<\/text>/g)];
    const byRow = new Map<string, { start?: string; end?: string }>();
    for (const t of texts) {
      const [, x, y, anchor, content] = t;
      if (anchor === "middle") continue;
      const row = byRow.get(y) ?? {};
      if (anchor === "start" && x === String(LABEL_X)) row.start = content;
      if (anchor === "end" && x === String(RIGHT)) row.end = content;
      byRow.set(y, row);
    }
    let checkedRows = 0;
    for (const { start, end } of byRow.values()) {
      if (start === undefined || end === undefined) continue;
      const g = rowGeometry(LABEL_X, start, end, 12.5);
      expect(g.overlapSafe).toBe(false);
      checkedRows++;
    }
    expect(checkedRows).toBeGreaterThan(0);
  });

  it("stamps LOCAL · DETERMINISTIC rotated within [-6°,-2°]", async () => {
    const svg = renderReceiptSvg(await modelFor(PRICED.source, PRICED.path));
    expect(svg).toContain('class="stamp"');
    expect(svg).toContain("LOCAL · DETERMINISTIC");
    const rot = Number(svg.match(/rotate\((-?[0-9.]+)/)![1]);
    expect(rot).toBeGreaterThanOrEqual(-6);
    expect(rot).toBeLessThanOrEqual(-2);
  });

  it("clears the ≥4.5 text-vs-card contrast bar in both themes", () => {
    for (const theme of ["light", "dark"] as ThemeName[]) {
      const t = THEMES[theme];
      expect(contrast(t.ink, t.card)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.muted, t.card)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("grows total height linearly with row count (no clipping)", () => {
    const three = fakeModel({ toolRows: [toolRow("A", 0.01, 100, 1), toolRow("B", 0.01, 100, 1), toolRow("C", 0.01, 100, 1)] });
    const eight = fakeModel({
      toolRows: Array.from({ length: 8 }, (_, i) => toolRow(`T${i}`, 0.01, 100, 1)),
    });
    const delta = svgHeight(renderReceiptSvg(eight)) - svgHeight(renderReceiptSvg(three));
    expect(delta).toBe(5 * ROW_H);
  });
});

describe("renderCompareSvg — R3", () => {
  it("emits one SVG with two cards and a delta line", async () => {
    const [a, b] = await Promise.all([modelFor(PRICED.source, PRICED.path), modelFor(LOOP.source, LOOP.path)]);
    const svg = renderCompareSvg(a, b);
    expect((svg.match(/<svg/g) ?? []).length).toBe(1);
    // two card groups (perforation masks perf-a and perf-b).
    expect(svg).toContain("perf-a");
    expect(svg).toContain("perf-b");
    // ratio-only delta line (I6: a "×" ratio, never better/worse wording).
    expect(svg).toMatch(/[0-9.]+×/);
    expect(svg).not.toMatch(/better|worse|winner|cheaper than/i);
  });

  it("colours nothing green/red across the two cards (I6)", async () => {
    const [a, b] = await Promise.all([modelFor(PRICED.source, PRICED.path), modelFor(PRICED.source, PRICED.path)]);
    const svg = renderCompareSvg(a, b);
    // The flag token is a red used only for waste values WITHIN a card, never as
    // a cross-card verdict. Two clean priced receipts use it as a paint nowhere
    // (`var(--flag,…)`); its hex still appears once in the :root definition,
    // which is why we assert on the paint reference, not the raw hex.
    expect(svg).not.toContain("var(--flag");
    // the delta line is muted, never flag/accent.
    const deltaTexts = [...svg.matchAll(/<text[^>]*fill="([^"]+)"[^>]*>[^<]*×[^<]*<\/text>/g)];
    expect(deltaTexts.length).toBeGreaterThan(0);
    for (const t of deltaTexts) {
      expect(t[1]).toContain(THEMES.light.muted);
    }
  });
});

describe("R4 — field-set parity between the terminal and SVG renderers", () => {
  function fieldsRead(model: ReceiptModel, render: (m: ReceiptModel) => unknown): Set<string> {
    const keys = new Set(Object.keys(model));
    const seen = new Set<string>();
    const proxy = new Proxy(model, {
      get(target, prop, recv) {
        if (typeof prop === "string" && keys.has(prop)) {
          seen.add(prop);
        }
        return Reflect.get(target, prop, recv);
      },
    });
    render(proxy);
    return seen;
  }

  it.each([
    ["priced+waste", PRICED],
    ["loop", LOOP],
  ])("both renderers read the same ReceiptModel fields (%s)", async (_label, fx) => {
    const model = await modelFor(fx.source, fx.path);
    const terminal = fieldsRead(model, (m) => renderReceiptLines(m, { color: false }));
    const svg = fieldsRead(model, (m) => renderReceiptSvg(m));
    expect([...svg].sort()).toEqual([...terminal].sort());
    expect(svg.size).toBeGreaterThan(0);
    for (const f of svg) {
      expect(Object.keys(model)).toContain(f);
    }
  });

  it("reads the same fields for the unpriceable (Cursor) degraded model", () => {
    const model = fakeModel({ unpriceable: true, modelMix: [], toolRows: [toolRow("edit", null, 0, 2)], totalUsd: null });
    const terminal = fieldsRead(model, (m) => renderReceiptLines(m, { color: false }));
    const svg = fieldsRead(model, (m) => renderReceiptSvg(m));
    expect([...svg].sort()).toEqual([...terminal].sort());
  });
});

describe("renderReceiptSvg — no samosa glyph on the receipt card (SPEC-0055)", () => {
  // The glyph's signature anchor — the module's first path, derived rather
  // than hardcoded so the SPEC-0079 R5 redesign (or any future one) can't
  // leave this negative test asserting against a glyph that no longer ships.
  const GLYPH_ANCHOR = `d="${/<path d="([^"]+)"/.exec(samosaGlyphMarkup())![1]}`;

  it("no template's SVG carries the glyph path, in either theme", async () => {
    const model = await modelFor(PRICED.source, PRICED.path);
    for (const template of ["classic", "grocery", "datavis"] as const) {
      for (const theme of ["light", "dark"] as ThemeName[]) {
        expect(renderReceiptSvg(model, { theme, template })).not.toContain(GLYPH_ANCHOR);
      }
    }
  });

  it("never emits a raw 🥟 or 🔺 codepoint in any template's SVG bytes", async () => {
    const model = await modelFor(PRICED.source, PRICED.path);
    for (const template of ["classic", "grocery", "datavis"] as const) {
      const svg = renderReceiptSvg(model, { template });
      expect(svg).not.toContain("🥟");
      expect(svg).not.toContain("🔺");
    }
  });
});

describe("samosa glyph single source (SPEC-0034 R2) — static surfaces can't import the module, so pin them to it", () => {
  // site/*.html are hand-authored static files and build-docs-site.mjs is a
  // plain .mjs script; none of them can import the TS glyph module at
  // runtime. Their inlined copies must stay byte-identical to the module's
  // <path> literals (four since SPEC-0079 R5), or the surfaces drift apart
  // silently. site/index.html no longer inlines the glyph in its samosa
  // footer link (post-redesign), so only surfaces that do inline it are pinned.
  const DUPLICATING_FILES = [
    "site/samosa.html",
    "site/view.html",
    "scripts/build-docs-site.mjs",
  ];

  it("every inlined copy carries the module's exact path sequence, and no legacy marks", () => {
    const paths = samosaGlyphMarkup().match(/<path d="[^"]*"\/>/g) ?? [];
    expect(paths).toHaveLength(4);
    // The full adjacent sequence, not per-path contains: proves order and
    // completeness, so a copy can't smuggle extra/legacy paths between the
    // module's own (Codex review of SPEC-0079 R5).
    const sequence = paths.join("");
    for (const file of DUPLICATING_FILES) {
      const html = readFileSync(file, "utf8");
      expect(html, `${file} drifted from samosa-glyph.ts`).toContain(sequence);
      // The retired face marks (pre-SPEC-0079 glyph) must be gone everywhere.
      expect(html, `${file} still carries a retired glyph mark`).not.toContain('<path d="M17 29');
      expect(html, `${file} still carries a retired glyph mark`).not.toContain('<path d="M21 20');
    }
  });
});

function metaLinesOf(model: ReceiptModel): string[] {
  const meta = buildReceiptView(model).blocks.find((b) => b.kind === "meta");
  return meta?.kind === "meta" ? meta.lines : [];
}

describe("titleLine — masthead honesty", () => {
  it("renders a truncated quoted title for a real session title", async () => {
    const model = await modelFor(PRICED.source, PRICED.path);
    const titled = metaLinesOf(model).filter((l) => l.startsWith("\u201C"));
    expect(titled).toHaveLength(1);
    expect(titled[0].length).toBeLessThanOrEqual(48);
  });

  it("renders NO title when the session title is markup-shaped (agent-injected XML is machine noise)", async () => {
    const model = { ...(await modelFor(PRICED.source, PRICED.path)), title: '<teammate-message teammate_id="x">hi</teammate-message>' };
    expect(metaLinesOf(model).some((l) => l.startsWith("\u201C"))).toBe(false);
  });
});
