// SPEC-0077 R2/R3/R4 — the shareable session card. Byte-goldens are gated by
// scripts/verify-goldens.mjs (session × {light,dark}); this file owns the
// objective properties: the R2 projection, the R4 privacy default (no title /
// project / path ever reaches the image), the honesty invariants (I2 zero-`$`
// when unpriced; `≥` floor marker), and the R3 PNG dims/decode contract.
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/index.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import type { ReceiptModel } from "../../src/receipt/model.js";
import { buildSessionCardModel, cardHeadline, renderCardSvg, CARD_THEMES, type CardModel } from "../../src/receipt/card.js";
import { rasterizeSvgToPng } from "../../src/receipt/png.js";
import { formatInt } from "../../src/receipt/format.js";
import type { ThemeName } from "../../src/receipt/svg.js";

const PRICED = { source: "claude-code", path: "test/fixtures/claude-code/clean-multi-tool-2-models.jsonl" };
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function modelFor(source: string, path: string): Promise<ReceiptModel> {
  const session = await loadById(source, path);
  if (!session) {
    throw new Error(`failed to load ${path}`);
  }
  return buildReceiptModel(session);
}

function pngDimensions(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe("buildSessionCardModel — R2 projection", () => {
  it("projects the per-session fields, scope=session", async () => {
    const card = buildSessionCardModel(await modelFor(PRICED.source, PRICED.path));
    expect(card.scope).toBe("session");
    expect(card.totalUsd).toBeCloseTo(0.1767, 4); // renders as $0.18
    expect(card.floored).toBe(false);
    expect(card.sessionCount).toBe(1);
    expect(card.roles).toEqual([]);
    expect(card.modelMix.map((m) => m.model)).toEqual(["claude-opus-4-8", "claude-sonnet-5"]);
    expect(card.toolRows.map((r) => r.tool)).toContain("Bash");
    // cache % is cacheServedPct over totalTokens (not the USD cache field).
    expect(card.cacheServedPct).toBe("85");
  });

  it("carries the session-only cheaper-model line (SPEC-0059 arithmetic reused)", async () => {
    const card = buildSessionCardModel(await modelFor(PRICED.source, PRICED.path));
    expect(card.cheaperModel?.label).toBe("same tokens on claude-haiku-4-5");
    expect(card.cheaperModel?.value).toBe("$0.04 (78% less)");
  });

  it("scopeLabel is the fixed agent + date, NEVER the session title (R4)", async () => {
    const model = await modelFor(PRICED.source, PRICED.path);
    expect(model.title).toBeDefined(); // the fixture has a prompt-derived title
    const card = buildSessionCardModel(model);
    expect(card.scopeLabel).toBe("Claude Code · Jun 18 2026");
    expect(card.scopeLabel).not.toContain(model.title!);
  });
});

describe("renderCardSvg — R4 privacy default (always sanitized)", () => {
  it("never emits the session title, in either theme", async () => {
    const model = await modelFor(PRICED.source, PRICED.path);
    const card = buildSessionCardModel(model);
    const titleWords = model.title!.split(/\s+/).filter((w) => w.length >= 4);
    expect(titleWords.length).toBeGreaterThan(0);
    for (const theme of ["light", "dark"] as ThemeName[]) {
      const svg = renderCardSvg(card, { theme });
      for (const word of titleWords) {
        expect(svg).not.toContain(word);
      }
    }
  });

  it("never emits a repo/branch/project/path even if the model carries one", async () => {
    // The projection reads a fixed field set; a hostile title/project on the
    // source model must not travel onto the card.
    const model: ReceiptModel = {
      ...(await modelFor(PRICED.source, PRICED.path)),
      title: "acme-corp/secret-repo on feature/login-x — /Users/me/work/app.ts",
    };
    const svg = renderCardSvg(buildSessionCardModel(model), { theme: "light" });
    expect(svg).not.toContain("acme-corp");
    expect(svg).not.toContain("secret-repo");
    expect(svg).not.toContain("feature/login-x");
    expect(svg).not.toContain("/Users/me/work");
  });
});

describe("renderCardSvg — R3 determinism + fixed viewbox", () => {
  it("is 1200×630, self-contained, byte-identical across renders, themes differ", async () => {
    const card = buildSessionCardModel(await modelFor(PRICED.source, PRICED.path));
    const light = renderCardSvg(card, { theme: "light" });
    expect(light).toContain('width="1200" height="630" viewBox="0 0 1200 630"');
    expect(light).not.toMatch(/xlink:href|<image|href="http/);
    expect(renderCardSvg(card, { theme: "light" })).toBe(light);
    expect(renderCardSvg(card, { theme: "dark" })).not.toBe(light);
  });

  it("colours the dominant model ink and the trailing/economical model teal (accent)", async () => {
    const card = buildSessionCardModel(await modelFor(PRICED.source, PRICED.path));
    const svg = renderCardSvg(card, { theme: "light" });
    // two models → [ink, accent]; both hexes appear as rect fills (bar + legend swatch).
    expect(svg).toContain(`fill="${CARD_THEMES.light.ink}"`);
    expect(svg).toContain(`fill="${CARD_THEMES.light.accent}"`);
  });
});

describe("renderCardSvg — I2 honesty", () => {
  it("no `$` glyph when nothing priced (tokens-only headline)", async () => {
    const base = await modelFor(PRICED.source, PRICED.path);
    const model: ReceiptModel = {
      ...base,
      totalUsd: null,
      priceDelta: null,
      modelMix: base.modelMix.map((m) => ({ ...m, usd: null })),
      toolRows: base.toolRows.map((r) => ({ ...r, usd: null })),
    };
    const svg = renderCardSvg(buildSessionCardModel(model), { theme: "light" });
    expect(svg.includes("$")).toBe(false);
    expect(svg).toContain("tok");
  });

  it("prefixes the `≥` floor marker when the total is a cache-tier lower bound", async () => {
    const model: ReceiptModel = { ...(await modelFor(PRICED.source, PRICED.path)), costLowerBoundCacheTier: true };
    const card = buildSessionCardModel(model);
    expect(card.floored).toBe(true);
    expect(renderCardSvg(card, { theme: "light" })).toContain("≥ $0.18");
  });

  it("floors the token-fallback headline too — an all-unpriced total that is incomplete shows `≥ N tok`", () => {
    // A PR-scope card can be BOTH unpriced (totalUsd null) AND floored (e.g. an
    // unreadable/partial atom). The token headline is a lower bound just like a
    // priced one, so it must carry the `≥` marker.
    const flooredUnpriced: CardModel = {
      scope: "pr",
      scopeLabel: "PR #7",
      totalUsd: null,
      floored: true,
      tokens: 12_345,
      modelMix: [],
      toolRows: [],
      sessionCount: 2,
      subagentCount: 0,
      roles: [],
    };
    const expected = `≥ ${formatInt(12_345)} tok`;
    expect(cardHeadline(flooredUnpriced)).toBe(expected);
    const svg = renderCardSvg(flooredUnpriced, { theme: "light" });
    expect(svg).toContain(expected);
    expect(svg.includes("$")).toBe(false); // still zero fabricated dollars (I2)

    // Contrast: an unpriced total that is NOT floored stays a bare `N tok`.
    const cleanUnpriced: CardModel = { ...flooredUnpriced, floored: false };
    expect(cardHeadline(cleanUnpriced)).toBe(`${formatInt(12_345)} tok`);
  });
});

describe("renderCardSvg — tool line-items fold to a `+ N more` roll-up", () => {
  it("collapses the tail when more than five tool rows exist", async () => {
    const base = await modelFor(PRICED.source, PRICED.path);
    const many = Array.from({ length: 8 }, (_, i) => ({ tool: `Tool${i}`, usd: 0.01, tokens: { input: 100, output: 0, cacheRead: 0, cacheCreation: 0, total: 100 }, callCount: 1 }));
    const svg = renderCardSvg(buildSessionCardModel({ ...base, toolRows: many }), { theme: "light" });
    // 4 named rows + one roll-up summing the remaining 4 ($0.04).
    expect(svg).toContain("+ 4 more");
    expect(svg).toContain("$0.04");
    expect(svg).toContain("Tool0");
    expect(svg).not.toContain("Tool7");
  });
});

describe("rasterizeSvgToPng — R3 card dims/decode (bytes NOT goldened)", () => {
  it("rasterizes the card to a 2400×1260 PNG (1200×630 × scale)", async () => {
    const card = buildSessionCardModel(await modelFor(PRICED.source, PRICED.path));
    const png = rasterizeSvgToPng(renderCardSvg(card, { theme: "light" }), 1200);
    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(pngDimensions(png)).toEqual({ width: 2400, height: 1260 });
  });
});
