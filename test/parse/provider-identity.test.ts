import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CodexAdapter } from "../../src/parse/codex.js";
import { buildReceiptModel } from "../../src/receipt/model.js";

const dir = mkdtempSync(path.join(tmpdir(), "aireceipts-provider-identity-"));
let seq = 0;

afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function loadCodex(modelProvider?: string) {
  const file = path.join(dir, `rollout-${seq++}.jsonl`);
  const sessionMeta = {
    timestamp: "2026-06-30T12:00:00.000Z",
    type: "session_meta",
    payload: {
      id: `provider-${seq}`,
      cwd: "/tmp/aireceipts-provider",
      ...(modelProvider !== undefined ? { model_provider: modelProvider } : {}),
    },
  };
  const records = [
    sessionMeta,
    {
      timestamp: "2026-06-30T12:00:01.000Z",
      type: "turn_context",
      payload: { model: "gpt-5.3-codex", cwd: "/tmp/aireceipts-provider" },
    },
    {
      timestamp: "2026-06-30T12:00:02.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10 },
          last_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10 },
        },
      },
    },
  ];
  writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  const session = await new CodexAdapter().loadSession(file);
  expect(session).not.toBeNull();
  return session!;
}

describe("Codex model_provider pricing identity", () => {
  it("keeps legacy inference only when model_provider is absent", async () => {
    const session = await loadCodex();
    expect(session.turns[0].pricingProvider).toBeUndefined();
    const receipt = await buildReceiptModel(session);
    expect(receipt.totalUsd).toBeCloseTo(0.0002835, 12);
  });

  it("prices an explicit direct OpenAI provider exactly", async () => {
    const session = await loadCodex("openai");
    expect(session.turns[0].pricingProvider).toBe("openai");
    const receipt = await buildReceiptModel(session);
    expect(receipt.totalUsd).toBeCloseTo(0.0002835, 12);
    expect(receipt.priceRowsUsed.map((row) => `${row.vendor}:${row.model}`)).toEqual(["openai:gpt-5.3-codex"]);
  });

  it.each(["azure", "openrouter", "company-codex-proxy"])(
    "blocks an explicit routed/custom provider (%s) while retaining tokens",
    async (provider) => {
      const session = await loadCodex(provider);
      expect(session.turns[0].pricingProvider).toBeNull();
      const receipt = await buildReceiptModel(session);
      expect(receipt.totalUsd).toBeNull();
      expect(receipt.totalTokens).toMatchObject({ input: 80, cacheRead: 20, output: 10, total: 110 });
      expect(receipt.priceRowsUsed).toEqual([]);
    },
  );
});
