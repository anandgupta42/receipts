// SPEC-0020 R2: the built-in fixture model the `templates` command renders each
// template from (a 6-line preview per template, so the listing SHOWS each style
// rather than describing it). A fully synthetic, priced ReceiptModel — the CLI
// never reads a test fixture at runtime. Its sessionId is chosen to give the
// grocery barcode varied group widths.
import type { ReceiptModel } from "./model.js";
import { emptyCostShape } from "../pricing/costShape.js";
import type { TokenUsage } from "../parse/types.js";

function usage(total: number): TokenUsage {
  return { input: total, output: 0, cacheRead: Math.round(total * 0.85), cacheCreation: 0, total };
}

/** A representative priced session used only for `aireceipts templates` previews. */
export function previewModel(): ReceiptModel {
  return {
    agentLabel: "Claude Code",
    source: "claude-code",
    sessionId: "a1b2c3d4-e5f6-7890-abcd-ef0123456789",
    title: "Add email validation to the signup form",
    startedAtMs: Date.UTC(2026, 5, 18, 9, 30, 30),
    durationMs: 630000,
    modelMix: [
      { model: "claude-opus-4-8", tokens: usage(8000), tokenShare: 0.87, usd: 0.15 },
      { model: "claude-sonnet-5", tokens: usage(1200), tokenShare: 0.13, usd: 0.03 },
    ],
    toolRows: [
      { tool: "Bash", usd: 0.05, tokens: usage(3200), callCount: 3 },
      { tool: "Edit", usd: 0.05, tokens: usage(2600), callCount: 2 },
      { tool: "(thinking/reply)", usd: 0.03, tokens: usage(1800), callCount: 2 },
      { tool: "Write", usd: 0.03, tokens: usage(1500), callCount: 2 },
      { tool: "Read", usd: 0.02, tokens: usage(900), callCount: 1 },
    ],
    totalUsd: 0.18,
    totalTokens: usage(10000),
    sessionTotalTokens: usage(10000),
    wasteLines: [],
    caveats: [],
    priceDelta: { cheaperModel: "claude-haiku-4-5", usd: 0.04, actualUsd: 0.18 },
    methodology: "preview",
    priceRowsUsed: [],
    unpriceable: false,
    costLowerBoundCacheTier: false,
    turnCount: 6,
    toolCallCount: 10,
    peakTurn: { tokens: 3200, turnNumber: 4 },
    cacheReadAtInputRateUsd: 0.12,
    costShape: emptyCostShape(),
  };
}
