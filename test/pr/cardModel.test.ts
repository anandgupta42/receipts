// SPEC-0077 R2/R2a — the PR-scope card aggregate. Byte-goldens (PR × {light,dark})
// are gated by scripts/verify-goldens.mjs; this file owns the objective aggregation
// properties: token-weighted model mix across contributors + readable subagents,
// per-tool roll-up including subagents, the `≥` floor on any unpriced/unreadable/
// excluded atom, the cheaper-model omission (R2), and the R2a additive contract
// (widening SubagentRow leaves the comment bytes and the ref payload unchanged).
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/index.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import type { ModelMixEntry, ReceiptModel } from "../../src/receipt/model.js";
import { emptyUsage } from "../../src/parse/util.js";
import { buildPrCardModel, type PrCardEntry } from "../../src/pr/cardModel.js";
import type { ContributorView } from "../../src/pr/body.js";
import { renderPrBody } from "../../src/pr/body.js";
import { buildPrReceiptPayload, serializePrReceipt } from "../../src/pr/payload.js";
import { deserializePrReceipt } from "../../src/pr/sanitize.js";
import type { SubagentRow } from "../../src/pr/rollup.js";
import { runPrDetailed, type PrDeps } from "../../src/pr/index.js";
import type { CommandResult, CommandRunner } from "../../src/pr/git.js";

const PRICED = { source: "claude-code", path: "test/fixtures/claude-code/clean-multi-tool-2-models.jsonl" };
const LOOP = { source: "claude-code", path: "test/fixtures/claude-code/loop-bash-5x.jsonl" };

async function modelFor(source: string, path: string): Promise<ReceiptModel> {
  const session = await loadById(source, path);
  if (!session) {
    throw new Error(`failed to load ${path}`);
  }
  return buildReceiptModel(session);
}

/** A minimal contributor view over a model — the fields the card reads plus the required PrBodyInput shape. */
function viewFor(role: ContributorView["role"], model: ReceiptModel, subagents: SubagentRow[] = []): ContributorView {
  return {
    role,
    sessionId: `s-${role}`,
    slice: { kind: "full", startTurn: 0, endTurn: 0, turnCount: 1, label: "entire session" },
    modelMix: model.modelMix,
    usd: model.totalUsd,
    tokens: model.totalTokens,
    subagents,
  };
}

function entryFor(role: ContributorView["role"], model: ReceiptModel, subagents: SubagentRow[] = []): PrCardEntry {
  return { view: viewFor(role, model, subagents), model };
}

function readableSubagent(model: ReceiptModel, filePath: string): SubagentRow {
  return {
    name: "child",
    model: model.modelMix[0]?.model,
    usd: model.totalUsd,
    tokens: model.totalTokens,
    unreadable: false,
    filePath,
    modelMix: model.modelMix,
    toolRows: model.toolRows,
  };
}

/** Token-weighted expected mix: sum every model's tokens across the given mixes, then share by the grand total. */
function expectedMix(...mixes: ModelMixEntry[][]): Map<string, number> {
  const byModel = new Map<string, number>();
  for (const mix of mixes) {
    for (const m of mix) {
      byModel.set(m.model, (byModel.get(m.model) ?? 0) + m.tokens.total);
    }
  }
  const total = [...byModel.values()].reduce((s, t) => s + t, 0);
  const shares = new Map<string, number>();
  for (const [model, tokens] of byModel) {
    shares.set(model, tokens / total);
  }
  return shares;
}

describe("buildPrCardModel — R2 aggregate over contributors + readable subagents", () => {
  it("token-weights the model mix across contributors (R2 model-mix rollup)", async () => {
    const priced = await modelFor(PRICED.source, PRICED.path);
    const loop = await modelFor(LOOP.source, LOOP.path);
    const card = buildPrCardModel([entryFor("orchestrator", priced), entryFor("builder", loop)], 189, { excludedCount: 0 });

    expect(card.scope).toBe("pr");
    expect(card.scopeLabel).toBe("PR #189");
    expect(card.sessionCount).toBe(2);
    // Shares are the token-weighted sum of both contributors' mixes, desc-ordered.
    const expected = expectedMix(priced.modelMix, loop.modelMix);
    expect(card.modelMix.map((m) => m.model).sort()).toEqual([...expected.keys()].sort());
    for (const entry of card.modelMix) {
      expect(entry.tokenShare).toBeCloseTo(expected.get(entry.model) as number, 10);
    }
    const shares = card.modelMix.map((m) => m.tokenShare);
    expect([...shares].sort((a, b) => b - a)).toEqual(shares); // desc order preserved
    expect(shares.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 10);
  });

  it("sums per-tool usd/tokens/callCount INCLUDING a readable subagent (R2 tool rollup)", async () => {
    const priced = await modelFor(PRICED.source, PRICED.path);
    const loop = await modelFor(LOOP.source, LOOP.path);
    // Orchestrator with one readable subagent whose breakdown is the loop model.
    const card = buildPrCardModel([entryFor("orchestrator", priced, [readableSubagent(loop, "p/subagents/a.jsonl")])], 7, {
      excludedCount: 0,
    });

    // A tool present in BOTH the parent slice and the subagent sums both.
    const parentBash = priced.toolRows.find((r) => r.tool === "Bash");
    const childBash = loop.toolRows.find((r) => r.tool === "Bash");
    expect(parentBash).toBeDefined();
    expect(childBash).toBeDefined();
    const cardBash = card.toolRows.find((r) => r.tool === "Bash");
    expect(cardBash).toBeDefined();
    expect(cardBash!.callCount).toBe(parentBash!.callCount + childBash!.callCount);
    expect(cardBash!.tokens).toBe(parentBash!.tokens.total + childBash!.tokens.total);
    expect(cardBash!.usd).toBeCloseTo((parentBash!.usd ?? 0) + (childBash!.usd ?? 0), 10);
    expect(card.subagentCount).toBe(1);
  });

  it("floors the headline and excludes an UNREADABLE child from the mix/tools (R2 floored PR)", async () => {
    const priced = await modelFor(PRICED.source, PRICED.path);
    const unreadable: SubagentRow = { name: "broken", usd: null, tokens: emptyUsage(), unreadable: true, filePath: "p/subagents/x.jsonl" };
    const card = buildPrCardModel([entryFor("orchestrator", priced, [unreadable])], 1, { excludedCount: 0 });

    expect(card.floored).toBe(true);
    expect(card.totalUsd).toBeCloseTo(priced.totalUsd as number, 10); // priced subtotal, floor marker rendered by the renderer
    // The unreadable child carries no modelMix/toolRows → mix/tools == the parent's alone.
    expect(card.modelMix.map((m) => m.model)).toEqual(priced.modelMix.map((m) => m.model));
    expect(card.subagentCount).toBe(1);
  });

  it("floors the headline when a readable atom is UNPRICED (R2 card floor, stricter than the comment split)", async () => {
    const priced = await modelFor(PRICED.source, PRICED.path);
    const tokensOnly: ReceiptModel = { ...(await modelFor(LOOP.source, LOOP.path)), totalUsd: null };
    // Contributor 2 priced to nothing (usd=null) but is readable → tokensOnlyCount>0 → floor.
    const card = buildPrCardModel([entryFor("orchestrator", priced), entryFor("builder", tokensOnly)], 2, { excludedCount: 0 });
    expect(card.floored).toBe(true);
    expect(card.totalUsd).toBeCloseTo(priced.totalUsd as number, 10);
  });

  it("OMITS the cheaper-model line on the PR card (R2 — no per-atom price provenance)", async () => {
    const priced = await modelFor(PRICED.source, PRICED.path);
    expect(priced.priceDelta).not.toBeNull(); // the session card WOULD show it
    const card = buildPrCardModel([entryFor("orchestrator", priced)], 5, { excludedCount: 0 });
    expect(card.cheaperModel).toBeUndefined();
  });

  it("carries the aggregate cache % over the summed usage (R2 cache)", async () => {
    const priced = await modelFor(PRICED.source, PRICED.path);
    const card = buildPrCardModel([entryFor("orchestrator", priced)], 3, { excludedCount: 0 });
    // Single contributor → same cache % the session card reports.
    expect(card.cacheServedPct).toBe("85");
  });

  it("groups contributor roles as counted labels (renderer joins with ` + `)", async () => {
    const priced = await modelFor(PRICED.source, PRICED.path);
    const loop = await modelFor(LOOP.source, LOOP.path);
    const card = buildPrCardModel(
      [entryFor("orchestrator", priced), entryFor("builder", loop), entryFor("builder", loop)],
      9,
      { excludedCount: 0 },
    );
    expect(card.roles).toEqual(["1 orchestrator", "2 builders"]);
  });
});

describe("buildPrCardModel — R2 partial-pricing floor (findings 1 & 4)", () => {
  it("floors the headline when a CONTRIBUTOR priced but left some turns unpriced (partial coverage → lower bound)", async () => {
    const priced = await modelFor(PRICED.source, PRICED.path);
    // A real partial-coverage model: priced overall, but the SPEC-0054 R3 caveat
    // records that some usage-carrying turns didn't price — its `$` is a floor.
    const partial: ReceiptModel = {
      ...priced,
      caveats: [...priced.caveats, { kind: "partial-priced-coverage", text: "caveat: 1 of 3 turns unpriced — TOTAL excludes their tokens" }],
    };
    const card = buildPrCardModel([entryFor("orchestrator", partial)], 11, { excludedCount: 0 });
    expect(card.floored).toBe(true);
    // The headline value is still the priced subtotal; only the `≥` marker changes.
    expect(card.totalUsd).toBeCloseTo(priced.totalUsd as number, 10);
  });

  it("floors the headline when a READABLE SUBAGENT is partially priced", async () => {
    const priced = await modelFor(PRICED.source, PRICED.path);
    const loop = await modelFor(LOOP.source, LOOP.path);
    const partialChild: SubagentRow = { ...readableSubagent(loop, "p/subagents/a.jsonl"), partialPriced: true };
    const card = buildPrCardModel([entryFor("orchestrator", priced, [partialChild])], 12, { excludedCount: 0 });
    expect(card.floored).toBe(true);
  });

  it("does NOT floor when every counted atom is fully priced (no partial coverage)", async () => {
    const priced = await modelFor(PRICED.source, PRICED.path);
    const loop = await modelFor(LOOP.source, LOOP.path);
    const card = buildPrCardModel(
      [entryFor("orchestrator", priced, [readableSubagent(loop, "p/s/a.jsonl")]), entryFor("builder", loop)],
      13,
      { excludedCount: 0 },
    );
    expect(card.floored).toBe(false);
  });

  it("renders a tool row that mixes priced + unpriced contributions as tokens, never a bare exact `$` (finding 4)", async () => {
    const priced = await modelFor(PRICED.source, PRICED.path);
    const parentBash = priced.toolRows.find((r) => r.tool === "Bash");
    expect(parentBash).toBeDefined();
    expect(parentBash!.usd).not.toBeNull();
    const bashUsage = { input: 500, output: 20, cacheRead: 0, cacheCreation: 0, total: 520 };
    const readUsage = { input: 80, output: 20, cacheRead: 0, cacheCreation: 0, total: 100 };
    // A readable, partially-priced subagent: its Read turn priced but its Bash
    // turn did not — so the child's Bash row is unpriced while the child overall
    // priced. Aggregated with the parent's PRICED Bash, the row mixes coverage.
    const mixedChild: SubagentRow = {
      name: "child",
      usd: 0.05,
      tokens: { input: 600, output: 40, cacheRead: 0, cacheCreation: 0, total: 640 },
      unreadable: false,
      filePath: "p/subagents/mixed.jsonl",
      modelMix: [],
      toolRows: [
        { tool: "Bash", usd: null, tokens: bashUsage, callCount: 3 },
        { tool: "Read", usd: 0.05, tokens: readUsage, callCount: 1 },
      ],
      partialPriced: true,
    };
    const card = buildPrCardModel([entryFor("orchestrator", priced, [mixedChild])], 14, { excludedCount: 0 });
    const cardBash = card.toolRows.find((r) => r.tool === "Bash");
    expect(cardBash).toBeDefined();
    // Mixed coverage → honest tokens, NOT a misleading exact dollar; tokens/calls still sum.
    expect(cardBash!.usd).toBeNull();
    expect(cardBash!.tokens).toBe(parentBash!.tokens.total + bashUsage.total);
    expect(cardBash!.callCount).toBe(parentBash!.callCount + 3);
    // A parent-only priced tool (untouched by the child) still shows its `$`.
    const otherPriced = priced.toolRows.find((r) => r.tool !== "Bash" && r.usd !== null);
    expect(otherPriced).toBeDefined();
    const cardOther = card.toolRows.find((r) => r.tool === otherPriced!.tool);
    expect(cardOther!.usd).not.toBeNull();
  });
});

describe("R2a — SubagentRow widening is additive (comment bytes + ref payload unchanged)", () => {
  it("renderPrBody is byte-identical whether or not subagents carry modelMix/toolRows", async () => {
    const priced = await modelFor(PRICED.source, PRICED.path);
    const loop = await modelFor(LOOP.source, LOOP.path);
    const bare: SubagentRow = { name: "child", model: "claude-opus-4-8", usd: loop.totalUsd, tokens: loop.totalTokens, unreadable: false, filePath: "p/subagents/a.jsonl" };
    const widened: SubagentRow = { ...bare, modelMix: loop.modelMix, toolRows: loop.toolRows };

    const withBare = renderPrBody({ contributors: [viewFor("orchestrator", priced, [bare])], excludedCount: 0 });
    const withWidened = renderPrBody({ contributors: [viewFor("orchestrator", priced, [widened])], excludedCount: 0 });
    expect(withWidened).toBe(withBare);
  });

  it("the SPEC-0065 ref payload strips modelMix/toolRows and re-validates under the strict SPEC-0066 schema", async () => {
    const priced = await modelFor(PRICED.source, PRICED.path);
    const loop = await modelFor(LOOP.source, LOOP.path);
    const widened: SubagentRow = { name: "child", model: "claude-opus-4-8", usd: loop.totalUsd, tokens: loop.totalTokens, unreadable: false, filePath: "p/subagents/a.jsonl", modelMix: loop.modelMix, toolRows: loop.toolRows, partialPriced: true };
    const bodyInput = { contributors: [viewFor("orchestrator", priced, [widened])], excludedCount: 0 };

    const json = serializePrReceipt(buildPrReceiptPayload(bodyInput, {}));
    expect(json).not.toContain("toolRows");
    expect(json).not.toContain("partialPriced");
    // The strict validator would reject an unknown `toolRows`/`modelMix` key on a SubagentRow.
    const result = deserializePrReceipt(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const sub = result.payload.bodyInput.contributors[0].subagents[0] as SubagentRow;
      expect(sub.toolRows).toBeUndefined();
      expect(sub.partialPriced).toBeUndefined();
      expect(sub.usd).toBe(loop.totalUsd);
    }
  });
});

describe("runPrDetailed — `pr --card` builds the PR card model", () => {
  const FIX = "test/fixtures/pr/claude-anchors.jsonl";
  const ok = (stdout: string): CommandResult => ({ stdout, stderr: "", code: 0, missing: false });
  const gitOk: CommandRunner = (_cmd, args) => {
    if (args[0] === "worktree") return ok("worktree /home/dev/repo\n");
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return ok("/home/dev/repo\n");
    if (args[0] === "rev-parse") return ok("origin/main\n");
    if (args[0] === "merge-base") return ok("0000000000000000000000000000000000000000\n");
    if (args[0] === "log")
      return ok(["b1c2d3e4f5061728394a5b6c7d8e9f0011223344", "2026-06-28T10:02:00.000Z", "feat: fixture commit"].join(" ") + "\n");
    return { stdout: "", stderr: "", code: 1, missing: false };
  };

  async function deps(): Promise<PrDeps> {
    const session = (await loadById("claude-code", FIX))!;
    return {
      listSessions: async () => [session],
      loadSession: async (summary) => loadById(summary.source, summary.id),
      runGit: gitOk,
      runGh: () => ok("[]"),
      rollup: async () => [],
      cwd: "/home/dev/repo",
      out: () => {},
      err: () => {},
    };
  }

  it("returns a scope=pr card with the local `PR #<n>` label on a dry run (no network)", async () => {
    const result = await runPrDetailed({ post: false, card: true, prNumber: 189 }, await deps());
    expect(result.bodyRendered).toBe(true);
    expect(result.cardModel).toBeDefined();
    expect(result.cardModel!.scope).toBe("pr");
    expect(result.cardModel!.scopeLabel).toBe("PR #189");
    expect(result.cardModel!.cheaperModel).toBeUndefined();
    expect(result.cardModel!.sessionCount).toBe(result.contributorCount);
  });

  it("builds no card when --card is absent", async () => {
    const result = await runPrDetailed({ post: false }, await deps());
    expect(result.cardModel).toBeUndefined();
  });
});
