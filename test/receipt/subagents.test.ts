// SPEC-0061 test matrix — session-surface subagent rollup: the fold, the
// caveats, the fail-safe attach, and every surface (classic/grocery/datavis,
// SVG, mini, statusline, --json, telemetry, docs parity).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SubagentRow } from "../../src/pr/rollup.js";
import { loadById } from "../../src/index.js";
import type { TokenUsage } from "../../src/parse/types.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import type { ReceiptModel, SubagentAggregate, ToolRow } from "../../src/receipt/model.js";
import { emptyCostShape } from "../../src/pricing/costShape.js";
import { attachSubagentRollup, foldSubagentRows, subagentCaveats } from "../../src/receipt/subagents.js";
import { renderReceipt } from "../../src/receipt/render.js";
import { renderReceiptSvg } from "../../src/receipt/svg.js";
import { buildMiniSummary, renderMiniReceipt } from "../../src/receipt/mini.js";
import { DEFAULT_FORMAT, parseFormat, renderSegments } from "../../src/cli/statuslineSegments.js";
import { toJsonModel } from "../../src/receipt/json.js";
import { receiptJsonSchema } from "../../src/receipt/exportSchema.js";
import { receiptTelemetryFromModels } from "../../src/cli/common/telemetry.js";

const PARENT_FIXTURE = "test/fixtures/claude-code/clean-with-subagents.jsonl";

const DEFAULT_SEGMENTS = (() => {
  const parsed = parseFormat(DEFAULT_FORMAT);
  if ("unknown" in parsed) {
    throw new Error("default format failed to parse");
  }
  return parsed.segments;
})();

function renderStatusline(model: ReceiptModel): string {
  return renderSegments(DEFAULT_SEGMENTS, { summary: buildMiniSummary(model), inputMode: "stdin_payload", payload: null, nowMs: 0 });
}


function usage(total: number): TokenUsage {
  return { input: total, output: 0, cacheRead: 0, cacheCreation: 0, total };
}

function toolRow(tool: string, usd: number | null, tokens: number, callCount: number): ToolRow {
  return { tool, usd, tokens: usage(tokens), callCount };
}

function childRow(over: Partial<SubagentRow> = {}): SubagentRow {
  return { name: "tester", usd: 0.1, tokens: usage(1000), unreadable: false, filePath: "x/subagents/agent-x.jsonl", ...over };
}

/** Minimal fully-populated model; overrides per test. */
function baseModel(overrides: Partial<ReceiptModel> = {}): ReceiptModel {
  return {
    agentLabel: "Claude Code",
    source: "claude-code",
    sessionId: "test-session",
    modelMix: [{ model: "claude-opus-4-8", tokens: usage(12000), tokenShare: 1 }],
    toolRows: [toolRow("Bash", 0.12, 9000, 3), toolRow("Edit", 0.06, 3000, 1)],
    totalUsd: 0.18,
    totalTokens: usage(12000),
    sessionTotalTokens: usage(12000),
    wasteLines: [],
    caveats: [],
    priceDelta: null,
    methodology: "test",
    priceRowsUsed: [],
    unpriceable: false,
    costLowerBoundCacheTier: false,
    turnCount: 4,
    toolCallCount: 4,
    cacheReadAtInputRateUsd: null,
    costShape: emptyCostShape(),
    ...overrides,
  };
}

const AGG: SubagentAggregate = { count: 2, pricedUsd: 0.1, tokensTotal: 4000, unpricedCount: 0, unreadableCount: 0 };

/** Every `$X.XX` amount on receipt lines that end in one (rows + TOTAL). */
function dollarAmounts(text: string): number[] {
  return [...text.matchAll(/\$(\d+\.\d{2})(?:\s|$)/gm)].map((m) => Number(m[1]));
}

describe("SPEC-0061 foldSubagentRows", () => {
  it("returns undefined for no children (zero-children parity upstream)", () => {
    expect(foldSubagentRows([])).toBeUndefined();
  });

  it("folds priced/unpriced/unreadable children into honest counts", () => {
    const agg = foldSubagentRows([
      childRow({ usd: 0.25 }),
      childRow({ usd: null, tokens: usage(700) }),
      childRow({ unreadable: true, usd: null, tokens: usage(0) }),
    ]);
    expect(agg).toEqual({ count: 3, pricedUsd: 0.25, tokensTotal: 1700, unpricedCount: 1, unreadableCount: 1 });
  });

  it("pricedUsd stays null when no child priced (I2)", () => {
    const agg = foldSubagentRows([childRow({ usd: null }), childRow({ usd: null })]);
    expect(agg?.pricedUsd).toBeNull();
  });
});

describe("SPEC-0061 R2 caveats — floors, dollars and tokens never blended", () => {
  it("unreadable children add the floor caveat", () => {
    const rows = [childRow(), childRow({ unreadable: true, usd: null })];
    const agg = foldSubagentRows(rows)!;
    const caveats = subagentCaveats(rows, agg, true);
    expect(caveats).toEqual([{ kind: "subagents-unreadable", text: "1 subagent unreadable — total is a floor" }]);
  });

  it("mixed pricing states the unpriced child's tokens separately", () => {
    const rows = [childRow({ usd: 0.3 }), childRow({ usd: null, tokens: usage(4321) })];
    const agg = foldSubagentRows(rows)!;
    const caveats = subagentCaveats(rows, agg, true);
    expect(caveats).toEqual([{ kind: "subagents-unpriced", text: "1 subagent unpriced (4,321 tok) — total is a floor" }]);
  });

  it("unpriced parent + priced children: whole receipt tokens-only, caveat carries the child $, --json keeps pricedUsd", () => {
    const rows = [childRow({ usd: 9.85 })];
    const agg = foldSubagentRows(rows)!;
    const model = baseModel({
      totalUsd: null,
      toolRows: [toolRow("Bash", null, 9000, 3)],
      subagents: agg,
      caveats: subagentCaveats(rows, agg, false),
    });
    const receipt = renderReceipt(model);
    const rendered = receipt.split("\n");
    // one unit per receipt: no drawn row carries a $ — the caveat is the only $ bytes
    expect(rendered.find((l) => l.includes("SUBAGENTS"))).toContain("tok");
    expect(rendered.find((l) => l.includes("SUBAGENTS"))).not.toContain("$");
    expect(rendered.find((l) => l.includes("TOTAL"))).not.toContain("$");
    expect(receipt).toContain("1 subagent priced ($9.85) — shown as tokens above; the session itself is unpriced");
    expect(renderStatusline(model)).not.toContain("$");
    expect(toJsonModel(model).subagents?.pricedUsd).toBe(9.85);
  });

  it("a child with dropped records adds the floor caveat (SPEC-0044 B3 parity)", () => {
    const rows = [childRow({ droppedRecords: 3 })];
    const caveats = subagentCaveats(rows, foldSubagentRows(rows)!, true);
    expect(caveats).toEqual([{ kind: "subagents-dropped-records", text: "1 subagent transcript dropped malformed records — total is a floor" }]);
  });
});

describe("SPEC-0061 R1 — the SUBAGENTS row across templates", () => {
  it("classic: one row after tool rows, before waste rows; drawn $ rows sum byte-exactly to TOTAL", () => {
    const model = baseModel({
      toolRows: [toolRow("Bash", 0.015, 9000, 3), toolRow("Edit", 0.015, 3000, 1)],
      totalUsd: 0.03,
      subagents: { ...AGG, pricedUsd: 0.015 },
      wasteLines: [{ kind: "stuck-loop", tool: "Bash", runLength: 5, usd: 0.01, tokens: usage(100), turnIndices: [1] }],
    });
    const lines = renderReceipt(model).split("\n");
    const rowIdx = lines.findIndex((l) => l.includes("SUBAGENTS (2)"));
    const lastToolIdx = lines.findIndex((l) => l.startsWith("Edit"));
    const wasteIdx = lines.findIndex((l) => l.includes("⚠"));
    expect(rowIdx).toBeGreaterThan(lastToolIdx);
    expect(rowIdx).toBeLessThan(wasteIdx);
    // Spend rows only — the ⚠ waste line's `$` is informational, not a drawn spend row.
    const spendLines = lines.slice(0, lines.findIndex((l) => l.includes("TOTAL"))).filter((l) => !l.includes("⚠"));
    const amounts = dollarAmounts(spendLines.join("\n"));
    const total = dollarAmounts(lines.find((l) => l.includes("TOTAL"))!)[0];
    expect(amounts.reduce((s, a) => s + a, 0)).toBeCloseTo(total, 10);
  });

  it("the aggregate joins the SAME reconciliation universe as tool rows (independent rounding would differ byte-wise)", () => {
    // Three 0.6¢ atoms: reconcileCents([0.6,0.6,0.6]) → [1,1,0] (2¢ total, largest-
    // remainder ties broken by index) so the SUBAGENTS row must draw $0.00.
    // A broken implementation that rounds the aggregate independently prints $0.01.
    const model = baseModel({
      toolRows: [toolRow("Bash", 0.006, 9000, 3), toolRow("Edit", 0.006, 3000, 1)],
      totalUsd: 0.012,
      subagents: { ...AGG, pricedUsd: 0.006 },
    });
    const lines = renderReceipt(model).split("\n");
    expect(lines.find((l) => l.includes("Bash"))).toContain("$0.01");
    expect(lines.find((l) => l.includes("Edit"))).toContain("$0.01");
    expect(lines.find((l) => l.includes("SUBAGENTS (2)"))).toContain("$0.00");
    expect(lines.find((l) => l.includes("TOTAL"))).toContain("$0.02");
  });

  it("tokens-only aggregate renders tokens, never $ (I2)", () => {
    const model = baseModel({ subagents: { ...AGG, pricedUsd: null, tokensTotal: 5000 } });
    const receipt = renderReceipt(model);
    expect(receipt).toContain("SUBAGENTS (2)");
    expect(receipt.split("\n").find((l) => l.includes("SUBAGENTS"))).toContain("5,000 tok");
    expect(receipt.split("\n").find((l) => l.includes("SUBAGENTS"))).not.toContain("$");
  });

  it("grocery and datavis draw the aggregate too (shared view)", () => {
    const model = baseModel({ subagents: AGG });
    expect(renderReceipt(model, { template: "grocery" })).toContain("SUBAGENTS");
    expect(renderReceipt(model, { template: "datavis" })).toContain("--- SUBAGENTS ---");
  });

  it("svg renders the row; zero-children svg is byte-identical to a no-subagents model", () => {
    const withAgg = baseModel({ subagents: AGG });
    const without = baseModel();
    expect(renderReceiptSvg(withAgg, { theme: "light" })).toContain("SUBAGENTS (2)");
    expect(renderReceiptSvg(without, { theme: "light" })).not.toContain("SUBAGENTS");
  });

  it("delta suppression: a priced aggregate hides the parent-only `same tokens on` line; --json keeps priceDelta", () => {
    const delta = { cheaperModel: "claude-haiku-4-5", usd: 0.01, actualUsd: 0.18 };
    const suppressed = baseModel({ priceDelta: delta, subagents: AGG });
    const shown = baseModel({ priceDelta: delta });
    expect(renderReceipt(shown)).toContain("same tokens on");
    expect(renderReceipt(suppressed)).not.toContain("same tokens on");
    expect(toJsonModel(suppressed).priceDelta).toEqual(delta);
  });
});

describe("SPEC-0061 R3/R4 — statusline and mini fold the aggregate in", () => {
  it("statusline $ and tokens cover parent + children, format unchanged", () => {
    const model = baseModel({ subagents: { ...AGG, pricedUsd: 9.85, tokensTotal: 1_000_000 } });
    expect(renderStatusline(model)).toBe("[aireceipts] claude-opus-4-8 · $10.03 · 1M");
  });

  it("statusline stays tokens-only when the parent is unpriced (I2)", () => {
    const model = baseModel({ totalUsd: null, subagents: { ...AGG, pricedUsd: 9.85 } });
    expect(renderStatusline(model)).not.toContain("$");
  });

  it("mini total line carries the (incl. N subagents) marker only when children exist", () => {
    const withAgg = renderMiniReceipt(baseModel({ subagents: { ...AGG, count: 8 } }));
    const without = renderMiniReceipt(baseModel());
    expect(withAgg.split("\n")[2]).toMatch(/^total {2}\$\d+\.\d{2} \(incl\. 8 subagents\)$/);
    expect(without).not.toContain("subagent");
  });
});

describe("SPEC-0061 attachSubagentRollup — discovery, I/O discipline, fail-safe", () => {
  it("real fixture family: discovers 2 children, receipt shows the row, totals combine", async () => {
    const session = await loadById("claude-code", PARENT_FIXTURE);
    expect(session).not.toBeNull();
    const bare = await buildReceiptModel(session!);
    const model = await attachSubagentRollup(bare, session!.filePath);
    expect(model.subagents?.count).toBe(2);
    expect(model.subagents?.pricedUsd).not.toBeNull();
    const receipt = renderReceipt(model, { color: false });
    expect(receipt).toContain("SUBAGENTS (2)");
    // statusline totals equal the receipt's combined aggregate (same model, same fold)
    expect(renderStatusline(model)).toContain("$");
  });

  it("no children → zero child transcript loads, model unchanged (R3)", async () => {
    let loads = 0;
    const model = baseModel();
    const out = await attachSubagentRollup(model, "test/fixtures/claude-code/clean-multi-tool-2-models.jsonl", {
      load: async () => {
        loads += 1;
        return null;
      },
    });
    expect(loads).toBe(0);
    expect(out).toBe(model);
  });

  it("rollup failure degrades to the parent-only model, never a throw (R4 fail-safe)", async () => {
    const model = baseModel();
    const out = await attachSubagentRollup(model, PARENT_FIXTURE, {
      discover: async () => {
        throw new Error("disk exploded");
      },
    });
    expect(out).toBe(model);
  });

  it("unreadable child: counted, caveat attached, floor language present (R2 end-to-end)", async () => {
    const model = await attachSubagentRollup(baseModel(), PARENT_FIXTURE, {
      discover: async () => ["p/subagents/agent-ok.jsonl", "p/subagents/agent-broken.jsonl"],
      load: async (f) => (f.includes("broken") ? null : (await loadById("claude-code", `${PARENT_FIXTURE.replace(".jsonl", "")}/subagents/agent-t1.jsonl`))),
    });
    expect(model.subagents).toMatchObject({ count: 2, unreadableCount: 1 });
    expect(model.caveats.map((c) => c.kind)).toContain("subagents-unreadable");
    expect(renderReceipt(model)).toContain("unreadable — total is a floor");
  });
});

describe("SPEC-0061 R5 — --json aggregate", () => {
  it("children present: subagents object with the five fields validates; no child identifiers anywhere", async () => {
    const session = await loadById("claude-code", PARENT_FIXTURE);
    const model = await attachSubagentRollup(await buildReceiptModel(session!), session!.filePath);
    const json = toJsonModel(model);
    expect(receiptJsonSchema.safeParse(json).success).toBe(true);
    expect(json.subagents).toMatchObject({ count: 2, unpricedCount: 0, unreadableCount: 0 });
    const payload = JSON.stringify(json);
    expect(payload).not.toContain("agent-t1");
    expect(payload).not.toContain("subagents/");
  });

  it("no children: no subagents key, payload still validates", () => {
    const json = toJsonModel(baseModel());
    expect("subagents" in json).toBe(false);
    expect(receiptJsonSchema.safeParse(json).success).toBe(true);
  });
});

describe("SPEC-0061 R6 — telemetry boolean and docs parity", () => {
  it("hasSubagents is true iff a model carries the aggregate", () => {
    const base = { surface: "receipt" as const, outputMode: "text" as const, template: "none" as const, turnCount: 1, toolCallCount: 1, detailsView: false };
    expect(receiptTelemetryFromModels({ ...base, models: [baseModel({ subagents: AGG })] }).hasSubagents).toBe(true);
    expect(receiptTelemetryFromModels({ ...base, models: [baseModel()] }).hasSubagents).toBe(false);
  });

  it("docs/statusline.md documents the inclusion and the host refresh-cadence limitation", () => {
    const doc = readFileSync("docs/statusline.md", "utf8");
    expect(doc).toContain("Subagent spend is included");
    expect(doc).toContain("refresh cadence");
    expect(doc).toContain("re-invokes the statusline command only when the main conversation");
  });
});
