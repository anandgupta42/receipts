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
    expect(renderSegments(segs("cost,tokens"), ctx())).toBe("$0.50 · 1k tok");
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
    expect(renderSegments(segs("cost,tokens"), unpriced)).toBe("1k tok");
  });

  it("the default format constant matches the spec-pinned list", () => {
    expect(DEFAULT_FORMAT).toBe("brand,cost,tokens,waste,quota5h");
    expect(SEGMENT_NAMES).toContain("quotaEta");
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
