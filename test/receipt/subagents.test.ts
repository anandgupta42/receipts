// SPEC-0061 test matrix — session-surface subagent rollup: the fold, the
// caveats, the fail-safe attach, and every surface (classic/grocery/datavis,
// SVG, mini, statusline, --json, telemetry, docs parity).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SubagentRow } from "../../src/pr/rollup.js";
import { loadById } from "../../src/index.js";
import type { Session, TokenUsage } from "../../src/parse/types.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import type { ReceiptModel, SubagentAggregate, ToolRow } from "../../src/receipt/model.js";
import { emptyCostShape } from "../../src/pricing/costShape.js";
import {
  attachSubagentRollup,
  buildFullSessionReceiptModel,
  buildFullSessionReceiptWithCoverage,
  foldSubagentRows,
  subagentCaveats,
} from "../../src/receipt/subagents.js";
import { renderReceipt } from "../../src/receipt/render.js";
import { renderReceiptSvg } from "../../src/receipt/svg.js";
import { buildMiniSummary, renderMiniReceipt } from "../../src/receipt/mini.js";
import { DEFAULT_FORMAT, parseFormat, renderSegments } from "../../src/cli/statuslineSegments.js";
import { toJsonModel } from "../../src/receipt/json.js";
import { receiptJsonSchema } from "../../src/receipt/exportSchema.js";
import { receiptTelemetryFromModels } from "../../src/cli/common/telemetry.js";
import { compareDeltaLine } from "../../src/receipt/compare.js";

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

function withUnknownModel(session: Session): Session {
  return {
    ...session,
    model: "unknown-model",
    turns: session.turns.map((turn) => ({
      ...turn,
      model: "unknown-model",
      ...(turn.pricingUnits
        ? { pricingUnits: turn.pricingUnits.map((unit) => ({ ...unit, model: "unknown-model" })) }
        : {}),
    })),
  };
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

const AGG: SubagentAggregate = {
  count: 2,
  pricedUsd: 0.1,
  tokensTotal: 4000,
  unpricedTokens: usage(0),
  unpricedCount: 0,
  unreadableCount: 0,
};

/** Every fixed-precision dollar amount on receipt lines that end in one (rows + TOTAL). */
function dollarAmounts(text: string): number[] {
  return [...text.matchAll(/\$(\d+\.\d{2,4})(?:\s|$)/gm)].map((m) => Number(m[1]));
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
    expect(agg).toEqual({
      count: 3,
      pricedUsd: 0.25,
      tokensTotal: 1700,
      unpricedTokens: usage(700),
      unpricedCount: 1,
      unreadableCount: 1,
    });
  });

  it("pricedUsd stays null when no child priced (I2)", () => {
    const agg = foldSubagentRows([childRow({ usd: null }), childRow({ usd: null })]);
    expect(agg?.pricedUsd).toBeNull();
  });

  it("counts a partially-priced child in both the dollar and unpriced ledgers", () => {
    const agg = foldSubagentRows([childRow({ usd: 0.25, tokens: usage(1000), unpricedTokens: usage(300) })]);
    expect(agg).toEqual({
      count: 1,
      pricedUsd: 0.25,
      tokensTotal: 1000,
      unpricedTokens: usage(300),
      unpricedCount: 1,
      unreadableCount: 0,
    });
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

  it("partial child pricing names only the exact unpriced turn tokens", () => {
    const rows = [childRow({ usd: 0.3, tokens: usage(1000), unpricedTokens: usage(275) })];
    const agg = foldSubagentRows(rows)!;
    expect(subagentCaveats(rows, agg, true)).toEqual([
      { kind: "subagents-unpriced", text: "1 subagent had unpriced usage (275 tok) — total is a floor" },
    ]);
  });

  it("a child cache-rate gap stays visible in the combined floor caveats", () => {
    const rows = [childRow({ costLowerBoundCacheTier: true })];
    expect(subagentCaveats(rows, foldSubagentRows(rows)!, true)).toContainEqual({
      kind: "cost-lower-bound-cache-tier",
      text: "1 subagent had observed cache tokens with no cited applicable rate — floor excludes them",
    });
  });

  it("unpriced parent + priced child: receipt separates the child floor from exact known-unpriced tokens", () => {
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
    expect(rendered.find((l) => l.includes("SUBAGENTS"))).toContain("≥ $9.85");
    expect(rendered.find((l) => l.includes("KNOWN PRICED SUBTOTAL"))).toContain("≥ $9.85");
    expect(rendered.find((l) => l.includes("KNOWN UNPRICED TOKENS"))).toContain("12,000 tok");
    expect(receipt).toContain("partial pricing coverage; invoice total unknown");
    expect(receipt).toContain("1 subagent priced (≥ $9.85) — child floor shown separately; parent session unpriced");
    expect(renderStatusline(model)).toContain("≥$9.85 subtotal (12k known unpriced; partial)");
    expect(renderMiniReceipt(model).split("\n")[2]).toBe(
      "total  known priced ≥ $9.85 · 12,000 tok known unpriced · coverage partial (incl. 1 subagent)",
    );
    const datavis = renderReceipt(model, { template: "datavis" });
    expect(datavis).toContain("[##########] = most tokens; others in proportion");
    expect(datavis.split("\n").find((line) => line.includes("SUBAGENTS (1)"))).toContain("≥ $9.85");
    expect(toJsonModel(model).subagents?.pricedUsd).toBe(9.85);
  });

  it("omits a misleading zero-token row when the partial gap is unmeasured", () => {
    const model = baseModel({ unobservedCacheWriteTokens: true });
    const receipt = renderReceipt(model);
    expect(receipt).toContain("KNOWN PRICED SUBTOTAL");
    expect(receipt).toContain("partial pricing coverage; invoice total unknown");
    expect(receipt).not.toContain("KNOWN UNPRICED TOKENS");
    expect(renderStatusline(model)).toContain("≥$0.18 subtotal (coverage partial)");
    expect(renderMiniReceipt(model)).toContain("known priced ≥ $0.18 · coverage partial");
  });

  it("a child with dropped records adds the floor caveat (SPEC-0044 B3 parity)", () => {
    const rows = [childRow({ droppedRecords: 3 })];
    const caveats = subagentCaveats(rows, foldSubagentRows(rows)!, true);
    expect(caveats).toEqual([{ kind: "subagents-dropped-records", text: "1 subagent transcript dropped malformed records — total is a floor" }]);
  });

  it("a GPT-5.6 Codex child propagates its missing cache-write bucket", () => {
    const rows = [childRow({ unobservedCacheWriteTokens: true })];
    expect(subagentCaveats(rows, foldSubagentRows(rows)!, true)).toContainEqual({
      kind: "unobserved-cache-write-tokens",
      text: "1 GPT-5.6 Codex subagent omitted cache-write tokens — floor excludes any write premium",
    });
  });
});

describe("SPEC-0061 R1 — the SUBAGENTS row across templates", () => {
  it("classic: one row after tool rows, before waste rows; every row stays below its raw amount", () => {
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
    expect(amounts).toEqual([0.015, 0.015, 0.015]);
    expect(total).toBe(0.045);
  });

  it("sub-cent tool and aggregate rows retain four-decimal lower bounds", () => {
    const model = baseModel({
      toolRows: [toolRow("Bash", 0.006, 9000, 3), toolRow("Edit", 0.006, 3000, 1)],
      totalUsd: 0.012,
      subagents: { ...AGG, pricedUsd: 0.006 },
    });
    const lines = renderReceipt(model).split("\n");
    expect(lines.find((l) => l.includes("Bash"))).toContain("$0.0060");
    expect(lines.find((l) => l.includes("Edit"))).toContain("$0.0060");
    expect(lines.find((l) => l.includes("SUBAGENTS (2)"))).toContain("$0.0060");
    expect(lines.find((l) => l.includes("TOTAL"))).toContain("$0.0180");
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
    const jsonDelta = toJsonModel(suppressed).priceDelta;
    expect(jsonDelta).toMatchObject(delta);
    expect(jsonDelta?.costEstimate).toMatchObject({ kind: "lower-bound", minUsd: delta.usd });
    expect(jsonDelta?.actualCostEstimate).toMatchObject({ kind: "lower-bound", minUsd: delta.actualUsd });
  });
});

describe("SPEC-0061 R3/R4 — statusline and mini fold the aggregate in", () => {
  it("statusline $ and tokens cover parent + children, format unchanged", () => {
    const model = baseModel({ subagents: { ...AGG, pricedUsd: 9.85, tokensTotal: 1_000_000 } });
    expect(renderStatusline(model)).toBe("[aireceipts] claude-opus-4-8 · ≥$10.03 · 1M");
  });

  it("statusline keeps the priced-child floor and labels the unpriced parent coverage", () => {
    const model = baseModel({ totalUsd: null, subagents: { ...AGG, pricedUsd: 9.85 } });
    expect(renderStatusline(model)).toContain("≥$9.85 subtotal (12k known unpriced; partial)");
  });

  it("mini total line carries the (incl. N subagents) marker only when children exist", () => {
    const withAgg = renderMiniReceipt(baseModel({ subagents: { ...AGG, count: 8 } }));
    const without = renderMiniReceipt(baseModel());
    expect(withAgg.split("\n")[2]).toMatch(/^total {2}≥ \$\d+\.\d{2} \(incl\. 8 subagents\)$/);
    expect(without).not.toContain("subagent");
  });

  it("compare delta uses the same parent+child floors as the rendered TOTALs", () => {
    const a = baseModel({ totalUsd: 0.1, subagents: { ...AGG, pricedUsd: 0.2 } });
    const b = baseModel({ totalUsd: 0.05, subagents: { ...AGG, pricedUsd: 0.05 } });
    expect(compareDeltaLine(a, b)).toContain("(≥ $0.30 vs ≥ $0.10)");
  });

  it("compare refuses a ratio when either combined floor has partial coverage", () => {
    const partial = baseModel({
      sessionId: "partial",
      totalUsd: null,
      subagents: { ...AGG, pricedUsd: 9.85 },
    });
    const full = baseModel({ sessionId: "full", totalUsd: 0.5 });
    const delta = compareDeltaLine(partial, full);
    expect(delta).toContain("not directly comparable");
    expect(delta).toContain("partial known priced ≥ $9.85 + 12,000 known-unpriced tok (partial)");
    expect(delta).toContain("full known priced ≥ $0.50 + 0 known-unpriced tok (full)");
    expect(delta).not.toContain("×");
  });
});

describe("SPEC-0061 attachSubagentRollup — discovery, I/O discipline, fail-safe", () => {
  it("the full-session composition seam includes each real child once", async () => {
    const session = await loadById("claude-code", PARENT_FIXTURE);
    expect(session).not.toBeNull();
    const model = await buildFullSessionReceiptModel(session!);
    expect(model.subagents?.count).toBe(2);
    expect(renderReceipt(model).match(/SUBAGENTS \(2\)/gu)).toHaveLength(1);
  });

  it("the full-session composition seam preserves a no-child model exactly", async () => {
    const session = await loadById("claude-code", "test/fixtures/claude-code/clean-multi-tool-2-models.jsonl");
    expect(session).not.toBeNull();
    const bare = await buildReceiptModel(session!);
    let loads = 0;
    const composed = await buildFullSessionReceiptModel(session!, {
      load: async () => {
        loads += 1;
        return null;
      },
    });
    expect(loads).toBe(0);
    expect(composed).toEqual(bare);
  });

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

  it("rollup failure degrades to a visibly caveated parent-only model, never a throw (R4 fail-safe)", async () => {
    const model = baseModel();
    const out = await attachSubagentRollup(model, PARENT_FIXTURE, {
      discover: async () => {
        throw new Error("disk exploded");
      },
    });
    expect(out.subagents).toBeUndefined();
    expect(out.caveats).toContainEqual({
      kind: "subagent-rollup-unavailable",
      text: "caveat: subagent rollup unavailable — total covers the parent session only; child cost and tokens may be missing",
    });
    expect(renderReceipt(out)).toContain("subagent rollup unavailable");
    expect(receiptJsonSchema.safeParse(toJsonModel(out)).success).toBe(true);

    const session = await loadById("claude-code", PARENT_FIXTURE);
    expect(session).not.toBeNull();
    const withCoverage = await buildFullSessionReceiptWithCoverage(session!, {
      discover: async () => {
        throw new Error("disk exploded");
      },
    });
    expect(withCoverage.coverage).toMatchObject({
      subagentUnpricedCount: null,
      subagentUnreadableCount: null,
      subagentRollupStatus: "unavailable",
      costScope: "parent-session",
      tokenScope: "parent-session",
    });
  });

  it("reports exact parent + readable-child unpriced tokens and keeps unreadable tokens unknown", async () => {
    const parent = await loadById("claude-code", PARENT_FIXTURE);
    const childPath = `${PARENT_FIXTURE.replace(".jsonl", "")}/subagents/agent-t1.jsonl`;
    const child = await loadById("claude-code", childPath);
    expect(parent).not.toBeNull();
    expect(child).not.toBeNull();

    const receipt = await buildFullSessionReceiptWithCoverage(withUnknownModel(parent!), {
      discover: async () => [childPath, "p/subagents/agent-unreadable.jsonl"],
      load: async (filePath) => (filePath === childPath ? withUnknownModel(child!) : null),
    });

    expect(receipt.coverage).toMatchObject({
      parentUnpricedTokens: parent!.totals.tokens,
      subagentUnpricedCount: 1,
      subagentUnreadableCount: 1,
      subagentRollupStatus: "complete",
      costScope: "parent-session-plus-readable-subagents",
      tokenScope: "parent-session-plus-readable-subagents",
    });
    expect(receipt.coverage.combinedUnpricedTokens.total).toBe(parent!.totals.tokens.total + child!.totals.tokens.total);
    expect(receipt.model.subagents).toMatchObject({ count: 2, unpricedCount: 1, unreadableCount: 1 });
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
