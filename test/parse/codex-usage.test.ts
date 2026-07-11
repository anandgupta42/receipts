// Codex cumulative-envelope regressions sampled structurally from current
// rollouts (usage numbers only; no transcript content). Newer rollouts can
// repeat an unchanged total snapshot with a stale non-zero `last_token_usage`,
// and forked/resumed rollouts can inherit a non-zero cumulative baseline.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { CodexAdapter } from "../../src/parse/codex.js";
import { codexFidelity } from "../../src/parse/fidelity/codex.js";
import type { TokenUsage } from "../../src/parse/types.js";
import { addUsage, emptyUsage } from "../../src/parse/util.js";
import { buildReceiptModel } from "../../src/receipt/model.js";

interface RawUsage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

const dir = mkdtempSync(path.join(tmpdir(), "aireceipts-codex-usage-"));
const adapter = new CodexAdapter();
let seq = 0;

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function raw(input: number, cached: number, output: number): RawUsage {
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    output_tokens: output,
    reasoning_output_tokens: 0,
    total_tokens: input + output,
  };
}

function envelope(total: RawUsage, last: RawUsage | undefined, second: number): unknown {
  return {
    timestamp: `2026-07-10T12:00:${second.toString().padStart(2, "0")}.000Z`,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: total, ...(last === undefined ? {} : { last_token_usage: last }) },
    },
  };
}

function context(model: string, second: number, modelProvider?: string): unknown {
  return {
    timestamp: `2026-07-10T12:00:${second.toString().padStart(2, "0")}.000Z`,
    type: "turn_context",
    payload: { model, cwd: "/tmp/aireceipts-model-switch", ...(modelProvider ? { model_provider: modelProvider } : {}) },
  };
}

function userMessage(second: number): unknown {
  return {
    timestamp: `2026-07-10T12:00:${second.toString().padStart(2, "0")}.000Z`,
    type: "event_msg",
    payload: { type: "user_message", message: "sanitized fixture" },
  };
}

async function load(records: unknown[]) {
  const file = path.join(dir, `rollout-${seq++}.jsonl`);
  writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  const session = await adapter.loadSession(file);
  expect(session).not.toBeNull();
  return session!;
}

async function loadLines(lines: string[]) {
  const file = path.join(dir, `rollout-${seq++}.jsonl`);
  writeFileSync(file, `${lines.join("\n")}\n`);
  const session = await adapter.loadSession(file);
  expect(session).not.toBeNull();
  return session!;
}

function summedTurns(session: Awaited<ReturnType<typeof load>>): TokenUsage {
  return session.turns.reduce((sum, turn) => addUsage(sum, turn.usage ?? emptyUsage()), emptyUsage());
}

describe("Codex cumulative usage envelopes", () => {
  it("does not bill a stale last_token_usage when the cumulative snapshot is unchanged", async () => {
    const snapshot = raw(300, 100, 30);
    const session = await load([envelope(snapshot, snapshot, 0), envelope(snapshot, snapshot, 1)]);

    expect(summedTurns(session)).toMatchObject({ input: 200, output: 30, cacheRead: 100, cacheCreation: 0, total: 330 });
    expect(session.totals.tokens).toEqual(summedTurns(session));
    expect(codexFidelity.validate(session)).toEqual([]);
  });

  it("subtracts an inherited cumulative baseline while retaining the first local delta", async () => {
    const session = await load([
      envelope(raw(1_000, 600, 100), raw(200, 100, 20), 0),
      envelope(raw(1_300, 800, 150), raw(300, 200, 50), 1),
    ]);

    expect(summedTurns(session)).toMatchObject({ input: 200, output: 70, cacheRead: 300, cacheCreation: 0, total: 570 });
    expect(session.totals.tokens).toEqual(summedTurns(session));
    expect(codexFidelity.validate(session)).toEqual([]);
  });

  it.each([
    ["missing", undefined],
    ["zero", raw(0, 0, 0)],
  ] as const)("safe-stops when the first non-zero cumulative snapshot has a %s last_token_usage", async (_label, last) => {
    const session = await load([
      context("gpt-5.6-sol", 0, "openai"),
      envelope(raw(200, 50, 20), last, 1),
    ]);

    expect(session.usageReconciliationFailed).toBe(true);
    expect(session.totals.tokens).toMatchObject({ input: 150, output: 20, cacheRead: 50, total: 220 });
    expect(session.unattributedUsage).toEqual(session.totals.tokens);
    expect(session.turns.every((turn) => turn.usage === undefined && turn.pricingUnits === undefined)).toBe(true);
    const receipt = await buildReceiptModel(session);
    expect(receipt.totalUsd).toBeNull();
    expect(receipt.caveats).toContainEqual(
      expect.objectContaining({ kind: "unattributed-aggregate-usage", text: expect.stringContaining("pricing disabled") }),
    );
  });

  it("keeps the full final envelope unattributed when a missing first delta is followed by a valid one", async () => {
    const session = await load([
      context("gpt-5.6-sol", 0, "openai"),
      envelope(raw(200, 50, 20), undefined, 1),
      envelope(raw(300, 70, 30), raw(100, 20, 10), 2),
    ]);

    expect(session.usageReconciliationFailed).toBe(true);
    expect(session.totals.tokens).toMatchObject({ input: 230, output: 30, cacheRead: 70, total: 330 });
    expect(session.unattributedUsage).toEqual(session.totals.tokens);
    expect(session.turns.every((turn) => turn.usage === undefined && turn.pricingUnits === undefined)).toBe(true);
    expect((await buildReceiptModel(session)).totalUsd).toBeNull();
  });

  it("safe-stops request pricing when a changed snapshot's last_token_usage disagrees", async () => {
    const session = await load([
      envelope(raw(200, 50, 20), raw(200, 50, 20), 0),
      envelope(raw(260, 70, 30), raw(90, 40, 15), 1),
    ]);

    // The final local envelope is still observable, but the changed event no
    // longer proves a request boundary. Keep it unattributed and never price it.
    expect(summedTurns(session).total).toBe(0);
    expect(session.totals.tokens).toMatchObject({ input: 190, output: 30, cacheRead: 70, cacheCreation: 0, total: 290 });
    expect(session.unattributedUsage).toEqual(session.totals.tokens);
    expect(session.usageReconciliationFailed).toBe(true);
    expect(codexFidelity.validate(session)).toContainEqual(expect.objectContaining({ check: "codex-request-boundaries" }));
    const receipt = await buildReceiptModel(session);
    expect(receipt.totalUsd).toBeNull();
    expect(receipt.caveats).toContainEqual(
      expect.objectContaining({ kind: "unattributed-aggregate-usage", text: expect.stringContaining("pricing disabled") }),
    );
  });

  it("safe-stops when a missing intermediate envelope would merge two base-tier requests into one long-context delta", async () => {
    const session = await load([
      context("gpt-5.6-sol", 0, "openai"),
      envelope(raw(200_000, 0, 1_000), raw(200_000, 0, 1_000), 1),
      // The 400K cumulative snapshot is absent/torn. The next visible delta is
      // 400K, but last_token_usage proves the actual final request was 200K.
      envelope(raw(600_000, 0, 3_000), raw(200_000, 0, 1_000), 3),
    ]);

    expect(session.totals.tokens.total).toBe(603_000);
    expect(session.unattributedUsage?.total).toBe(603_000);
    expect(session.turns.every((turn) => turn.usage === undefined && turn.pricingUnits === undefined)).toBe(true);
    expect((await buildReceiptModel(session)).totalUsd).toBeNull();
  });

  it("safe-stops when the first reported request exceeds its cumulative total or a later cumulative component decreases", async () => {
    const impossibleFirst = await load([
      context("gpt-5.6-sol", 0, "openai"),
      envelope(raw(100, 0, 10), raw(200, 0, 20), 1),
    ]);
    expect(impossibleFirst.usageReconciliationFailed).toBe(true);
    expect((await buildReceiptModel(impossibleFirst)).totalUsd).toBeNull();

    const reset = await load([
      context("gpt-5.6-sol", 0, "openai"),
      envelope(raw(200, 0, 20), raw(200, 0, 20), 1),
      envelope(raw(150, 0, 30), raw(10, 0, 10), 2),
    ]);
    expect(reset.usageReconciliationFailed).toBe(true);
    expect((await buildReceiptModel(reset)).totalUsd).toBeNull();
  });

  it("safe-stops when legacy per-message usage precedes a cumulative envelope", async () => {
    const session = await load([
      context("gpt-5.6-sol", 0, "openai"),
      {
        timestamp: "2026-07-10T12:00:01.000Z",
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [], usage: raw(200_000, 0, 1_000) },
      },
      envelope(raw(400_000, 0, 2_000), raw(200_000, 0, 1_000), 2),
    ]);

    expect(session.usageReconciliationFailed).toBe(true);
    expect(session.unattributedUsage?.total).toBe(201_000);
    expect((await buildReceiptModel(session)).totalUsd).toBeNull();
  });

  it("safe-stops request pricing after any malformed Codex record", async () => {
    const first = envelope(raw(200_000, 0, 1_000), raw(200_000, 0, 1_000), 1);
    const second = envelope(raw(400_000, 0, 2_000), raw(200_000, 0, 1_000), 3);
    const session = await loadLines([
      JSON.stringify(context("gpt-5.6-sol", 0, "openai")),
      JSON.stringify(first),
      "{\"truncated\":",
      JSON.stringify(second),
    ]);

    expect(session.droppedRecords).toBe(1);
    expect(session.usageReconciliationFailed).toBe(true);
    expect(session.unattributedUsage?.total).toBe(402_000);
    expect((await buildReceiptModel(session)).totalUsd).toBeNull();
  });

  it("rejects cached_input_tokens greater than input_tokens instead of clamping the request", async () => {
    const malformedLast = {
      ...raw(100, 20, 10),
      input_tokens: 20,
      cached_input_tokens: 21,
    };
    const session = await load([
      context("gpt-5.6-sol", 0, "openai"),
      envelope(raw(200, 50, 20), raw(200, 50, 20), 1),
      envelope(raw(300, 70, 30), malformedLast, 2),
    ]);

    expect(session.usageReconciliationFailed).toBe(true);
    expect(session.totals.tokens).toMatchObject({ input: 230, output: 30, cacheRead: 70, total: 330 });
    expect(session.unattributedUsage).toEqual(session.totals.tokens);
    expect(session.turns.every((turn) => turn.usage === undefined && turn.pricingUnits === undefined)).toBe(true);
    expect((await buildReceiptModel(session)).totalUsd).toBeNull();
  });

  it("rejects a negative value in every raw Codex usage field", async () => {
    const fields: Array<keyof RawUsage> = [
      "input_tokens",
      "cached_input_tokens",
      "output_tokens",
      "reasoning_output_tokens",
      "total_tokens",
    ];

    for (const field of fields) {
      const malformedLast = { ...raw(100, 20, 10), [field]: -1 };
      const session = await load([
        context("gpt-5.6-sol", 0, "openai"),
        envelope(raw(200, 50, 20), raw(200, 50, 20), 1),
        envelope(raw(300, 70, 30), malformedLast, 2),
      ]);

      expect(session.usageReconciliationFailed, field).toBe(true);
      expect(session.unattributedUsage, field).toEqual(session.totals.tokens);
      expect(session.turns.every((turn) => turn.usage === undefined && turn.pricingUnits === undefined), field).toBe(true);
      expect((await buildReceiptModel(session)).totalUsd, field).toBeNull();
    }
  });

  it("attributes each usage delta to the model active for that turn", async () => {
    const session = await load([
      context("gpt-5.4-mini", 0),
      envelope(raw(200, 100, 20), raw(200, 100, 20), 1),
      userMessage(2),
      context("gpt-5.3-codex", 3),
      envelope(raw(500, 200, 50), raw(300, 100, 30), 4),
    ]);

    expect(session.model).toBe("gpt-5.4-mini");
    expect(session.turns.map((turn) => turn.model)).toEqual(["gpt-5.4-mini", "gpt-5.3-codex"]);
    expect(codexFidelity.validate(session)).toEqual([]);
    const receipt = await buildReceiptModel(session);
    // Independent oracle: turn 1 = $0.0001725 at 5.4-mini; turn 2 =
    // $0.0007875 at 5.3-codex. Freezing the first model would fail this.
    expect(receipt.totalUsd).toBeCloseTo(0.00096, 12);
  });

  it("preserves request units inside one turn so GPT-5.6 tiers never use the turn aggregate", async () => {
    const session = await load([
      context("gpt-5.6-sol", 0, "openai"),
      envelope(raw(200_000, 100_000, 1_000), raw(200_000, 100_000, 1_000), 1),
      envelope(raw(400_000, 200_000, 2_000), raw(200_000, 100_000, 1_000), 2),
    ]);

    expect(session.turns).toHaveLength(1);
    expect(session.turns[0].pricingUnits).toHaveLength(2);
    expect(session.turns[0].usage).toMatchObject({ input: 200_000, cacheRead: 200_000, output: 2_000 });
    const receipt = await buildReceiptModel(session);
    // Each 200K request costs 0.58 at the base tier. Pricing the 400K turn
    // aggregate would incorrectly apply the long tier and produce 2.29.
    expect(receipt.totalUsd).toBeCloseTo(1.16, 12);
  });

  it("accumulates every legacy per-message usage record inside one user turn", async () => {
    const session = await load([
      context("gpt-5.3-codex", 0, "openai"),
      {
        timestamp: "2026-07-10T12:00:01.000Z",
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [], usage: raw(200, 100, 20) },
      },
      {
        timestamp: "2026-07-10T12:00:02.000Z",
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [], usage: raw(300, 100, 30) },
      },
    ]);

    expect(session.turns).toHaveLength(1);
    expect(session.turns[0].pricingUnits).toHaveLength(2);
    expect(session.turns[0].usage).toMatchObject({ input: 300, cacheRead: 200, output: 50, total: 550 });
    expect(session.totals.tokens).toEqual(session.turns[0].usage);
  });

  it("prices direct model_provider turns and keeps routed Codex turns tokens-only", async () => {
    const session = await load([
      context("gpt-5.3-codex", 0, "openai"),
      envelope(raw(200, 100, 20), raw(200, 100, 20), 1),
      userMessage(2),
      context("gpt-5.3-codex", 3, "azure"),
      envelope(raw(500, 200, 50), raw(300, 100, 30), 4),
    ]);

    expect(session.turns.map((turn) => turn.pricingProvider)).toEqual(["openai", null]);
    const receipt = await buildReceiptModel(session);
    expect(receipt.totalUsd).toBeCloseTo(0.0004725, 12);
    expect(receipt.unpricedTokens).toMatchObject({ input: 200, cacheRead: 100, output: 30, total: 330 });
  });

  it("property: any number of identical cumulative snapshots bills one delta", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          input: fc.integer({ min: 1, max: 500_000 }),
          cached: fc.integer({ min: 0, max: 500_000 }),
          output: fc.integer({ min: 0, max: 100_000 }),
        }),
        fc.integer({ min: 1, max: 8 }),
        async ({ input, cached, output }, copies) => {
          const snapshot = raw(input + cached, cached, output);
          const session = await load(Array.from({ length: copies }, (_, i) => envelope(snapshot, snapshot, i)));

          expect(summedTurns(session)).toMatchObject({ input, cacheRead: cached, output, total: input + cached + output });
          expect(session.totals.tokens).toEqual(summedTurns(session));
          expect(codexFidelity.validate(session)).toEqual([]);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("property: arbitrary inherited baselines never enter local rollout totals", async () => {
    const usageParts = fc.record({
      input: fc.integer({ min: 0, max: 500_000 }),
      cached: fc.integer({ min: 0, max: 500_000 }),
      output: fc.integer({ min: 0, max: 100_000 }),
    });
    await fc.assert(
      fc.asyncProperty(usageParts, usageParts, usageParts, async (baseline, first, second) => {
        const firstLocal = first.input + first.cached + first.output === 0 ? { ...first, input: 1 } : first;
        const secondLocal = second.input + second.cached + second.output === 0 ? { ...second, output: 1 } : second;
        const cumulative = (local: typeof first) =>
          raw(
            baseline.input + baseline.cached + local.input + local.cached,
            baseline.cached + local.cached,
            baseline.output + local.output,
          );
        const delta = (local: typeof first) => raw(local.input + local.cached, local.cached, local.output);
        const combined = {
          input: firstLocal.input + secondLocal.input,
          cached: firstLocal.cached + secondLocal.cached,
          output: firstLocal.output + secondLocal.output,
        };
        const session = await load([
          envelope(cumulative(firstLocal), delta(firstLocal), 0),
          envelope(cumulative(combined), delta(secondLocal), 1),
        ]);

        expect(summedTurns(session)).toMatchObject({
          input: combined.input,
          cacheRead: combined.cached,
          output: combined.output,
          total: combined.input + combined.cached + combined.output,
        });
        expect(session.totals.tokens).toEqual(summedTurns(session));
        expect(codexFidelity.validate(session)).toEqual([]);
      }),
      { numRuns: 50 },
    );
  });
});
