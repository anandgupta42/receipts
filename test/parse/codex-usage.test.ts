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

function envelope(total: RawUsage, last: RawUsage, second: number): unknown {
  return {
    timestamp: `2026-07-10T12:00:${second.toString().padStart(2, "0")}.000Z`,
    type: "event_msg",
    payload: { type: "token_count", info: { total_token_usage: total, last_token_usage: last } },
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

  it("uses the cumulative difference when a changed snapshot's last_token_usage disagrees", async () => {
    const session = await load([
      envelope(raw(200, 50, 20), raw(200, 50, 20), 0),
      envelope(raw(260, 70, 30), raw(90, 40, 15), 1),
    ]);

    // Second cumulative delta is input=40, cache=20, output=10, while the
    // reported `last_token_usage` claims input=50, cache=40, output=15. The
    // cumulative envelope is authoritative after baseline establishment.
    expect(summedTurns(session)).toMatchObject({ input: 190, output: 30, cacheRead: 70, cacheCreation: 0, total: 290 });
    expect(session.totals.tokens).toMatchObject({ input: 190, output: 30, cacheRead: 70, cacheCreation: 0, total: 290 });
    expect(codexFidelity.validate(session)).toEqual([]);
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
