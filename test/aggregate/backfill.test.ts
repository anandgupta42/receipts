// SPEC-0056 — the pure planning half of `backfill`: filesystem-safe slugs (R3, a
// session id can be an absolute file path), zero-padded sequence naming, the
// `--since`/`--limit` filters (R6), degraded-summary honesty (R7), and the
// marker-bearing deterministic manifest (R3/R4/R5).
import { describe, expect, it } from "vitest";
import {
  MANIFEST_MARKER,
  backfillFileName,
  buildManifest,
  filterSummaries,
  planBackfill,
  slugForId,
} from "../../src/aggregate/backfill.js";
import type { AgentSource, SessionSummary, TokenUsage } from "../../src/parse/types.js";

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
const DAY = 86_400_000;

function usage(): TokenUsage {
  return { input: 10, output: 5, cacheRead: 0, cacheCreation: 0, total: 15 };
}

function summary(id: string, opts: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    source: (opts.source ?? "claude-code") as AgentSource,
    filePath: `/u/.claude/projects/x/${id}.jsonl`,
    totals: { tokens: usage(), turnCount: 1, toolCallCount: 0 },
    ...opts,
  };
}

describe("slugForId (R3)", () => {
  it("reduces an absolute file path id to a safe basename — no path separators", () => {
    const slug = slugForId("/Users/anand/.codex/sessions/2026/07/rollout-2026-07-05T12h.jsonl");
    expect(slug).toBe("rollout-2026-07-05T12h.jsonl");
    expect(slug).not.toContain("/");
  });

  it("replaces every character outside [A-Za-z0-9._-] with '-'", () => {
    expect(slugForId("a b:c*d?e")).toBe("a-b-c-d-e");
  });

  it("truncates to 40 characters", () => {
    expect(slugForId("x".repeat(80))).toHaveLength(40);
  });

  it("handles Windows-style separators and empty ids", () => {
    expect(slugForId("C:\\Users\\a\\session.jsonl")).toBe("session.jsonl");
    expect(slugForId("")).toBe("session");
    expect(slugForId("///")).toBe("session");
  });
});

describe("backfillFileName (R3)", () => {
  it("is <seq>-<source>-<slug>.txt with the seq zero-padded to the given width", () => {
    expect(backfillFileName(3, 3, summary("abc"))).toBe("003-claude-code-abc.txt");
    expect(backfillFileName(12, 2, summary("abc", { source: "codex" }))).toBe("12-codex-abc.txt");
  });
});

describe("filterSummaries (R6)", () => {
  const s = [
    summary("newest", { endedAt: NOW }),
    summary("mid", { endedAt: NOW - DAY }),
    summary("old", { endedAt: NOW - 10 * DAY }),
    summary("timeless"),
  ];

  it("drops sessions that ended before --since, keeps the rest", () => {
    const kept = filterSummaries(s, { sinceMs: NOW - 2 * DAY });
    expect(kept.map((x) => x.id)).toEqual(["newest", "mid", "timeless"]);
  });

  it("keeps a session with no timestamps (cannot be proven older than the cutoff)", () => {
    expect(filterSummaries([summary("timeless")], { sinceMs: NOW }).map((x) => x.id)).toEqual(["timeless"]);
  });

  it("falls back to startedAt when endedAt is missing", () => {
    const started = summary("started-only", { startedAt: NOW - 10 * DAY });
    expect(filterSummaries([started], { sinceMs: NOW - DAY })).toEqual([]);
  });

  it("--limit keeps only the N most recent (list is already newest-first)", () => {
    expect(filterSummaries(s, { limit: 2 }).map((x) => x.id)).toEqual(["newest", "mid"]);
  });

  it("--since and --limit compose (since first, then limit)", () => {
    const kept = filterSummaries(s, { sinceMs: NOW - 2 * DAY, limit: 1 });
    expect(kept.map((x) => x.id)).toEqual(["newest"]);
  });
});

describe("planBackfill (R3/R6/R7)", () => {
  it("pads seq to the width of the matched count and preserves newest-first order", () => {
    const many = Array.from({ length: 12 }, (_, i) => summary(`s${i}`, { endedAt: NOW - i * DAY }));
    const plan = planBackfill(many, {});
    expect(plan.discoveredCount).toBe(12);
    expect(plan.entries[0].fileName).toBe("01-claude-code-s0.txt");
    expect(plan.entries[11].fileName).toBe("12-claude-code-s11.txt");
  });

  it("marks a degraded summary as a load failure up front (R7 — counted, not dropped)", () => {
    const plan = planBackfill([summary("ok"), summary("bad", { degraded: "unreadable" })], {});
    expect(plan.entries.map((e) => e.loadFailed)).toEqual([false, true]);
  });
});

describe("buildManifest (R3/R4/R5)", () => {
  it("opens with the fixed marker line, lists files in order, trailing newline", () => {
    const manifest = buildManifest(["1-claude-code-a.txt", "2-codex-b.txt"]);
    expect(manifest).toBe(`${MANIFEST_MARKER}\n1-claude-code-a.txt\n2-codex-b.txt\n`);
  });

  it("is byte-identical across calls with the same input (no wall-clock content)", () => {
    expect(buildManifest(["a.txt"])).toBe(buildManifest(["a.txt"]));
  });
});
