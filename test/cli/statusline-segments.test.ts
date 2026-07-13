// SPEC-0062 R3/R4 test matrix — the `--format` segments engine and the
// quota-window state file behind `quotaEta`. Pure-function tests against
// constructed contexts, plus the state-file battery on a temp dir.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { buildMiniSummary } from "../../src/receipt/mini.js";
import type { ReceiptModel } from "../../src/receipt/model.js";
import type { TokenUsage } from "../../src/parse/types.js";
import {
  DEFAULT_FORMAT,
  parseFormat,
  renderSegments,
  SEGMENT_NAMES,
  type SegmentContext,
  type SegmentName,
} from "../../src/cli/statuslineSegments.js";
import {
  MIN_READING_GAP_MS,
  projectCapCrossingMs,
  readPriorReading,
  writeReading,
  type QuotaReading,
} from "../../src/cli/quotaWindow.js";
import { runStatusline } from "../../src/cli/index.js";

function usage(total: number): TokenUsage {
  return { input: total, output: 0, cacheRead: 0, cacheCreation: 0, total };
}

function model(overrides: Partial<ReceiptModel> = {}): ReceiptModel {
  return {
    agentLabel: "Claude Code",
    source: "claude-code",
    sessionId: "s",
    modelMix: [],
    toolRows: [],
    totalUsd: 0.5,
    totalTokens: usage(1000),
    sessionTotalTokens: usage(1000),
    wasteLines: [],
    caveats: [],
    priceDelta: null,
    methodology: "test",
    priceRowsUsed: [],
    unpriceable: false,
    costLowerBoundCacheTier: false,
    turnCount: 1,
    toolCallCount: 0,
    cacheReadAtInputRateUsd: null,
    ...overrides,
  };
}

function ctx(over: Partial<SegmentContext> = {}): SegmentContext {
  return { summary: buildMiniSummary(model()), inputMode: "stdin_payload", payload: null, nowMs: 0, ...over };
}

function segs(spec: string): SegmentName[] {
  const parsed = parseFormat(spec);
  if ("unknown" in parsed) {
    throw new Error(`unexpected parse failure: ${parsed.unknown}`);
  }
  return parsed.segments;
}

const WINDOW = { resets_at: 1_800_018_000 }; // epoch seconds
const RESETS_AT_MS = WINDOW.resets_at * 1000;

function quotaPayload(pct: number): unknown {
  return { rate_limits: { five_hour: { used_percentage: pct, resets_at: WINDOW.resets_at } } };
}

describe("SPEC-0062 R3 — parseFormat", () => {
  it("ignores whitespace around commas and keeps duplicates (the format is literal)", () => {
    expect(segs(" brand , brand ,cost")).toEqual(["brand", "brand", "cost"]);
  });

  it("rejects unknown and empty segment names with the offending name", () => {
    expect(parseFormat("brand,bogus")).toEqual({ unknown: "bogus" });
    expect(parseFormat("")).toEqual({ unknown: "" });
    expect(parseFormat("brand,,cost")).toEqual({ unknown: "" });
  });
});

describe("SPEC-0062 R3 — renderSegments", () => {
  it("renders exactly the requested segments, ·-joined", () => {
    expect(renderSegments(segs("cost,tokens"), ctx())).toBe("≥$0.50 · 1k");
  });

  it("duplicate segments render twice", () => {
    expect(renderSegments(segs("brand,brand"), ctx())).toBe("[aireceipts] [aireceipts]");
  });

  it("quota7d renders from the payload when requested explicitly", () => {
    const payload = { rate_limits: { seven_day: { used_percentage: 41.2 } } };
    expect(renderSegments(segs("quota7d"), ctx({ payload }))).toBe("7d 41%");
  });

  it("quota segments omit themselves in disk-fallback mode (stdin-only facts)", () => {
    const line = renderSegments(segs("brand,quota5h"), ctx({ inputMode: "disk_fallback", payload: null }));
    expect(line).toBe("[aireceipts · Claude Code]");
  });

  it("I2: cost omits itself on an unpriced session — no zero-fill, no $ bytes", () => {
    const unpriced = ctx({ summary: buildMiniSummary(model({ totalUsd: null })) });
    expect(renderSegments(segs("cost,tokens"), unpriced)).toBe("1k");
  });

  it("labels known-token and unmeasured partial floors without implying a complete total", () => {
    const knownGap = buildMiniSummary(model({ unpricedTokens: usage(250) }));
    expect(renderSegments(segs("cost"), ctx({ summary: knownGap }))).toBe(
      "≥$0.50 subtotal (250 known unpriced; partial)",
    );

    const unmeasuredGap = buildMiniSummary(model({ unobservedCacheWriteTokens: true }));
    expect(renderSegments(segs("cost,burn"), ctx({ summary: unmeasuredGap }))).toBe(
      "≥$0.50 subtotal (coverage partial)",
    );
  });

  it("the default format constant matches the spec-pinned list", () => {
    expect(DEFAULT_FORMAT).toBe("brand,model,cost,burn,tokens,context,waste,quota5h");
    expect(SEGMENT_NAMES).toContain("model");
    expect(SEGMENT_NAMES).toContain("quotaEta");
  });
});

describe("SPEC-0071 — rich statusline (burn, context, quota countdown, M/B tokens)", () => {
  it("R1: tokens use abbreviated M formatting", () => {
    expect(renderSegments(segs("tokens"), ctx({ summary: buildMiniSummary(model({ totalTokens: usage(501_368_000) })) }))).toBe("501M");
  });

  it("R1: billion-scale tokens use the B suffix (never 1000M)", () => {
    expect(renderSegments(segs("tokens"), ctx({ summary: buildMiniSummary(model({ totalTokens: usage(1_500_000_000) })) }))).toBe("1.5B");
    // just past the M ceiling: ~999.5M rounds up into B, never renders "1000M"
    expect(renderSegments(segs("tokens"), ctx({ summary: buildMiniSummary(model({ totalTokens: usage(999_500_000) })) }))).toBe("1B");
  });

  it("R2: context segment from context_window.used_percentage; omitted when absent/out-of-range", () => {
    expect(renderSegments(segs("context"), ctx({ payload: { context_window: { used_percentage: 42 } } }))).toBe("ctx 42%");
    expect(renderSegments(segs("context"), ctx({ payload: { context_window: { used_percentage: 1_700_000_000 } } }))).toBe(""); // CC epoch-bug guard
    expect(renderSegments(segs("context"), ctx({ payload: {} }))).toBe("");
  });

  it("R3: burn is a lower-bound $/hr over the session wall-clock; omitted with no duration/price", () => {
    expect(renderSegments(segs("burn"), ctx({ summary: buildMiniSummary(model({ totalUsd: 40, durationMs: 1_800_000 })) }))).toBe("≥$80/hr"); // observed $40 floor / 0.5h
    expect(renderSegments(segs("burn"), ctx())).toBe(""); // model() has no durationMs
    expect(renderSegments(segs("burn"), ctx({ summary: buildMiniSummary(model({ durationMs: 1_800_000, totalUsd: null })) }))).toBe("");
    expect(renderSegments(segs("burn"), ctx({ summary: buildMiniSummary(model({ durationMs: 1_800_000, unpriceable: true, totalUsd: null })) }))).toBe("");
    // Codex #1 — non-finite / negative inputs never render a fabricated $NaN/$Infinity/negative rate
    expect(renderSegments(segs("burn"), ctx({ summary: buildMiniSummary(model({ totalUsd: NaN, durationMs: 1_800_000 })) }))).toBe("");
    expect(renderSegments(segs("burn"), ctx({ summary: buildMiniSummary(model({ totalUsd: 40, durationMs: NaN })) }))).toBe("");
    expect(renderSegments(segs("burn"), ctx({ summary: buildMiniSummary(model({ totalUsd: -5, durationMs: 1_800_000 })) }))).toBe("");
  });

  it("R4: quota5h shows an inline reset countdown, with sub-hour / no-reset / past-reset handling", () => {
    const at = (msBefore: number) => ctx({ payload: quotaPayload(26), nowMs: RESETS_AT_MS - msBefore });
    expect(renderSegments(segs("quota5h"), at((2 * 3600 + 13 * 60) * 1000))).toBe("5h 26% ↺2h13m");
    expect(renderSegments(segs("quota5h"), at(45 * 60 * 1000))).toBe("5h 26% ↺45m");
    expect(renderSegments(segs("quota5h"), ctx({ payload: { rate_limits: { five_hour: { used_percentage: 26 } } }, nowMs: 0 }))).toBe("5h 26%"); // no resets_at
    expect(renderSegments(segs("quota5h"), ctx({ payload: quotaPayload(26), nowMs: RESETS_AT_MS + 60_000 }))).toBe("5h 26%"); // reset already past
    // Codex #2 — a ms-as-seconds / garbage resets_at is beyond ~8 days out → countdown omitted, not ↺…000h0m
    expect(renderSegments(segs("quota5h"), ctx({ payload: { rate_limits: { five_hour: { used_percentage: 26, resets_at: 1_800_018_000_000 } } }, nowMs: 0 }))).toBe("5h 26%");
  });

  it("R4: quota7d gets the same reset countdown", () => {
    const payload = { rate_limits: { seven_day: { used_percentage: 55, resets_at: WINDOW.resets_at } } };
    expect(renderSegments(segs("quota7d"), ctx({ payload, nowMs: RESETS_AT_MS - 30 * 60 * 1000 }))).toBe("7d 55% ↺30m");
  });

  it("R5: the rich default renders every segment in order", () => {
    const summary = buildMiniSummary(model({ totalUsd: 423.26, durationMs: 7_200_000, totalTokens: usage(501_368_000) })); // observed floor / 2h
    const payload = { context_window: { used_percentage: 42 }, rate_limits: { five_hour: { used_percentage: 26, resets_at: WINDOW.resets_at } } };
    const nowMs = RESETS_AT_MS - (2 * 3600 + 13 * 60) * 1000;
    expect(renderSegments(segs(DEFAULT_FORMAT), ctx({ summary, payload, nowMs }))).toBe("[aireceipts] ≥$423.26 · ≥$211/hr · 501M · ctx 42% · 5h 26% ↺2h13m");
  });

  it("R5: degrades to cost + tokens when no payload/duration data", () => {
    expect(renderSegments(segs(DEFAULT_FORMAT), ctx({ payload: null }))).toBe("[aireceipts] ≥$0.50 · 1k");
  });

  it("R6: rendered segments contain no ANSI escape codes", () => {
    const summary = buildMiniSummary(model({ totalUsd: 40, durationMs: 1_800_000, totalTokens: usage(501_368_000) }));
    const payload = { context_window: { used_percentage: 42 }, rate_limits: { five_hour: { used_percentage: 26, resets_at: WINDOW.resets_at } } };
    expect(renderSegments(segs(DEFAULT_FORMAT), ctx({ summary, payload, nowMs: 0 }))).not.toContain(String.fromCharCode(27));
  });
});

describe("SPEC-0076 R1/R2 — the model segment", () => {
  /** A summary whose dominant model is `m` (or none, for the Cursor/omit case). */
  function summaryWithModel(m: string | null) {
    return buildMiniSummary(model({ modelMix: m === null ? [] : [{ model: m, tokens: usage(1000), tokenShare: 1 }] }));
  }

  it("R3 default: a full stdin payload renders the current model between brand and cost", () => {
    // $4.20 / (1_680_000ms = 0.4666h) = $9/hr; 2h13m before the window reset.
    const summary = buildMiniSummary(
      model({ totalUsd: 4.2, durationMs: 1_680_000, totalTokens: usage(128_000), modelMix: [{ model: "claude-opus-4-8", tokens: usage(128_000), tokenShare: 1 }] }),
    );
    const payload = {
      model: { id: "claude-opus-4-8", display_name: "Opus" },
      context_window: { used_percentage: 42 },
      rate_limits: { five_hour: { used_percentage: 24, resets_at: WINDOW.resets_at } },
    };
    const nowMs = RESETS_AT_MS - (2 * 3600 + 13 * 60) * 1000;
    expect(renderSegments(segs(DEFAULT_FORMAT), ctx({ summary, payload, nowMs }))).toBe(
      "[aireceipts] Opus · ≥$4.20 · ≥$9/hr · 128k · ctx 42% · 5h 24% ↺2h13m",
    );
  });

  it("R1 precedence: the payload display_name beats the summary model in stdin mode", () => {
    const payload = { model: { display_name: "Opus" } };
    expect(renderSegments(segs("brand,model"), ctx({ summary: summaryWithModel("claude-sonnet-5"), payload }))).toBe("[aireceipts] Opus");
  });

  it("R2 trim: a padded display_name renders trimmed", () => {
    expect(renderSegments(segs("brand,model"), ctx({ payload: { model: { display_name: " Opus " } } }))).toBe("[aireceipts] Opus");
  });

  it("R2 64-char boundary: exactly 64 chars is accepted", () => {
    const name = "a".repeat(64);
    expect(renderSegments(segs("model"), ctx({ payload: { model: { display_name: name } } }))).toBe(name);
  });

  it.each([
    ["absent model", {}],
    ["non-string", { model: { display_name: 42 } }],
    ["empty", { model: { display_name: "" } }],
    ["whitespace-only", { model: { display_name: "   " } }],
    ["65 chars", { model: { display_name: "a".repeat(65) } }],
    ["C0 newline", { model: { display_name: "Opus\nX" } }],
    ["DEL", { model: { display_name: "Opus\u007fX" } }],
    ["C1 NEL", { model: { display_name: "Opus\u0085X" } }],
    ["U+2028 line separator", { model: { display_name: "Opus\u2028X" } }],
    ["U+2029 paragraph separator", { model: { display_name: "Opus\u2029X" } }],
  ])("R1/R2 fallback: stdin %s falls back to the summary model", (_case, payload) => {
    expect(renderSegments(segs("brand,model"), ctx({ summary: summaryWithModel("claude-opus-4-8"), payload }))).toBe("[aireceipts] claude-opus-4-8");
  });

  it("R1 stale-payload gate: disk fallback ignores a parseable payload model, uses the summary model", () => {
    const payload = { model: { display_name: "Opus" } };
    expect(
      renderSegments(segs("brand,model"), ctx({ inputMode: "disk_fallback", summary: summaryWithModel("claude-opus-4-8"), payload })),
    ).toBe("[aireceipts · Claude Code] claude-opus-4-8");
  });

  it("R3 disk fallback: a priced Codex session with duration renders the spec's exact line", () => {
    // $1.10 / (990_000ms = 0.275h) = $4/hr.
    const summary = buildMiniSummary(
      model({
        agentLabel: "Codex",
        source: "codex",
        totalUsd: 1.1,
        durationMs: 990_000,
        totalTokens: usage(84_000),
        sessionTotalTokens: usage(84_000),
        modelMix: [{ model: "gpt-5.2-codex", tokens: usage(84_000), tokenShare: 1 }],
      }),
    );
    expect(renderSegments(segs(DEFAULT_FORMAT), ctx({ inputMode: "disk_fallback", summary, payload: null }))).toBe(
      "[aireceipts · Codex] gpt-5.2-codex · ≥$1.10 · ≥$4/hr · 84k",
    );
  });

  it("R1 omitted: no payload model and a null summary model omits the segment entirely (Cursor)", () => {
    const cursor = ctx({ summary: summaryWithModel(null), payload: null });
    expect(renderSegments(segs("brand,model"), cursor)).toBe("[aireceipts]");
    expect(renderSegments(segs("model"), cursor)).toBe("");
  });

  it("R2 fallback guarded: an over-long or control-bearing summary model is omitted, not rendered", () => {
    expect(renderSegments(segs("model"), ctx({ summary: summaryWithModel("a".repeat(65)), payload: null }))).toBe("");
    expect(renderSegments(segs("model"), ctx({ summary: summaryWithModel("bad\u0007model"), payload: null }))).toBe("");
  });
});

describe("SPEC-0062 R3 — runStatusline fail-fast on a malformed format", () => {
  it("unknown segment: exit 1, valid list on stderr, nothing on stdout", async () => {
    const stdin = Readable.from([]) as unknown as NodeJS.ReadStream;
    (stdin as unknown as { isTTY: boolean }).isTTY = true;
    let out = "";
    let err = "";
    const code = await runStatusline(
      stdin,
      async () => null,
      (s) => {
        out += s;
      },
      undefined,
      {
        format: "brand,bogus",
        writeError: (s) => {
          err += s;
        },
      },
    );
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toContain('unknown statusline segment "bogus"');
    for (const name of SEGMENT_NAMES) {
      expect(err).toContain(name);
    }
  });
});

describe("SPEC-0062 R4 — quota-window state file", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "aireceipts-quota-"));

  it("round-trips a reading atomically and self-heals from garbage", () => {
    const file = join(dir(), "quota-window.json");
    const reading: QuotaReading = { observedAtMs: 1000, usedPercentage: 10, resetsAt: WINDOW.resets_at };
    writeReading(file, reading);
    expect(readPriorReading(file)).toEqual(reading);
    writeFileSync(file, "{not json");
    expect(readPriorReading(file)).toBeNull();
    writeReading(file, reading);
    expect(readPriorReading(file)).toEqual(reading);
  });

  it("rejects schema-invalid state (missing/out-of-range fields)", () => {
    const file = join(dir(), "quota-window.json");
    writeFileSync(file, JSON.stringify({ observedAtMs: 1, usedPercentage: 130, resetsAt: 2 }));
    expect(readPriorReading(file)).toBeNull();
  });
});

describe("SPEC-0062 R4 — projectCapCrossingMs guards", () => {
  const base: QuotaReading = { observedAtMs: 0, usedPercentage: 20, resetsAt: WINDOW.resets_at };

  it("projects the straight-line crossing when every guard holds", () => {
    // 20% → 30% over 5 minutes = 2%/min; 70% remaining → +35 min.
    const current: QuotaReading = { ...base, observedAtMs: 300_000, usedPercentage: 30 };
    expect(projectCapCrossingMs(base, current)).toBe(300_000 + 35 * 60_000);
  });

  it("omits across a window rollover (resets_at changed)", () => {
    const current: QuotaReading = { observedAtMs: 300_000, usedPercentage: 30, resetsAt: WINDOW.resets_at + 18_000 };
    expect(projectCapCrossingMs(base, current)).toBeNull();
  });

  it("omits on falling or flat usage", () => {
    expect(projectCapCrossingMs(base, { ...base, observedAtMs: 300_000, usedPercentage: 20 })).toBeNull();
    expect(projectCapCrossingMs(base, { ...base, observedAtMs: 300_000, usedPercentage: 15 })).toBeNull();
  });

  it("omits when readings are under the 60s gap (near-zero denominator)", () => {
    expect(projectCapCrossingMs(base, { ...base, observedAtMs: MIN_READING_GAP_MS - 1, usedPercentage: 30 })).toBeNull();
  });

  it("omits when the prior reading is in the future (clock skew)", () => {
    const future: QuotaReading = { ...base, observedAtMs: 900_000 };
    expect(projectCapCrossingMs(future, { ...base, observedAtMs: 300_000, usedPercentage: 30 })).toBeNull();
  });

  it("omits an out-of-Date-range crossing instead of rendering NaN:NaN (garbage resets_at backstop)", () => {
    // Crossing ≈ 6.4e16 ms: BEFORE the absurd reset (9e21 ms) so the post-reset
    // guard passes, but beyond Date's ±8.64e15 range — only the backstop can omit it.
    const prior: QuotaReading = { observedAtMs: 0, usedPercentage: 20, resetsAt: 9e18 };
    const current: QuotaReading = { observedAtMs: 8e15, usedPercentage: 30, resetsAt: 9e18 };
    expect(projectCapCrossingMs(prior, current)).toBeNull();
  });

  it("omits when the crossing would land after the window resets", () => {
    // 0.1%/5min an hour before reset: the straight line crosses ~66h later, far past resets_at.
    const prior: QuotaReading = { ...base, observedAtMs: RESETS_AT_MS - 3_600_000 };
    const current: QuotaReading = { ...base, observedAtMs: RESETS_AT_MS - 3_300_000, usedPercentage: 20.1 };
    expect(projectCapCrossingMs(prior, current)).toBeNull();
  });
});

describe("SPEC-0062 R3 — duplicate stateful segments stay literal", () => {
  it("quotaEta named twice renders identical text twice and touches state once", () => {
    const file = join(mkdtempSync(join(tmpdir(), "aireceipts-quota-")), "quota-window.json");
    // Seed a prior reading so the ETA actually renders.
    writeReading(file, { observedAtMs: RESETS_AT_MS - 3_600_000, usedPercentage: 20, resetsAt: WINDOW.resets_at });
    const line = renderSegments(segs("quotaEta,quotaEta"), ctx({ payload: quotaPayload(30), nowMs: RESETS_AT_MS - 3_300_000, quotaStatePath: file }));
    const parts = line.split(" · ");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe(parts[1]);
    expect(parts[0]).toMatch(/^≈ 5h cap \d{2}:\d{2} UTC$/);
    // State holds the CURRENT reading exactly once (a second evaluation would have overwritten it after reading it back).
    expect(readPriorReading(file)).toMatchObject({ usedPercentage: 30 });
  });
});

describe("SPEC-0062 R4 — quotaEta segment end-to-end", () => {
  it("cold start: writes state, omits the segment; second reading renders the labeled ≈ ETA", () => {
    const file = join(mkdtempSync(join(tmpdir(), "aireceipts-quota-")), "quota-window.json");
    const first = renderSegments(segs("quotaEta"), ctx({ payload: quotaPayload(20), nowMs: RESETS_AT_MS - 3_600_000, quotaStatePath: file }));
    expect(first).toBe("");
    expect(readPriorReading(file)).not.toBeNull();
    // +5 minutes, +10% → 2%/min → cap in 35 min, well before reset.
    const second = renderSegments(segs("quotaEta"), ctx({ payload: quotaPayload(30), nowMs: RESETS_AT_MS - 3_300_000, quotaStatePath: file }));
    expect(second).toMatch(/^≈ 5h cap \d{2}:\d{2} UTC$/);
  });

  it("corrupt state: segment omitted, file rewritten with the current reading, no throw", () => {
    const file = join(mkdtempSync(join(tmpdir(), "aireceipts-quota-")), "quota-window.json");
    writeFileSync(file, "garbage");
    const line = renderSegments(segs("quotaEta"), ctx({ payload: quotaPayload(20), nowMs: RESETS_AT_MS - 3_600_000, quotaStatePath: file }));
    expect(line).toBe("");
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ usedPercentage: 20 });
  });

  it("payload without resets_at: segment omitted, state untouched", () => {
    const file = join(mkdtempSync(join(tmpdir(), "aireceipts-quota-")), "quota-window.json");
    const payload = { rate_limits: { five_hour: { used_percentage: 20 } } };
    const line = renderSegments(segs("quotaEta"), ctx({ payload, quotaStatePath: file }));
    expect(line).toBe("");
    expect(readPriorReading(file)).toBeNull();
  });
});
