// SPEC-0031 — per-commit attribution: partition completeness, the chronology
// rule, hostile subjects, the labeled bucket, and the ledger reconciliation
// property (tokens exact, USD within 1e-9) through the REAL segmentation and
// pricing code. The red path (a dropped turn) must fail reconciliation.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Session, Turn } from "../../src/parse/types.js";
import { emptyUsage, withTotal } from "../../src/parse/util.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { parseBranchCommitLine, type BranchCommits } from "../../src/pr/git.js";
import { anchorEvents, computeSlice } from "../../src/pr/slice.js";
import {
  buildPerCommitRows,
  PER_COMMIT_METHODOLOGY,
  renderPerCommitLines,
  segmentSlice,
  SUBJECT_DISPLAY_CAP,
} from "../../src/pr/perCommit.js";
import { renderPrArtifactHtml, type ArtifactInput } from "../../src/pr/html.js";

const SHA_A = "aaaa111122223333444455556666777788889999";
const SHA_B = "bbbb111122223333444455556666777788889999";
const usage = (input: number, output: number) => withTotal({ ...emptyUsage(), input, output });

/** newest-first, like git log: B is newer, A is chronologically earliest. */
const COMMITS: BranchCommits = {
  shas: [SHA_B, SHA_A],
  commitMs: [2000, 1000],
  subjects: ["feat: second", "feat: first"],
};

function turn(index: number, opts: { commitSha?: string; commitShas?: string[]; push?: string; input?: number; output?: number } = {}): Turn {
  const toolCalls = [];
  const shas = opts.commitShas ?? (opts.commitSha !== undefined ? [opts.commitSha] : []);
  if (shas.length > 0) {
    toolCalls.push({
      name: "Bash",
      input: { command: "git commit -m x" },
      output: shas.map((s) => `[main ${s.slice(0, 7)}] x`).join("\n"),
      status: "ok" as const,
    });
  }
  if (opts.push !== undefined) {
    toolCalls.push({ name: "Bash", input: { command: "git push" }, output: opts.push, status: "ok" as const });
  }
  return { index, timestamp: 1000 + index, model: "claude-opus-4-8", usage: usage(opts.input ?? 500, opts.output ?? 50), toolCalls };
}

function session(turns: Turn[]): Session {
  const tokens = turns.reduce((acc, t) => {
    acc.input += t.usage?.input ?? 0;
    acc.output += t.usage?.output ?? 0;
    return acc;
  }, withTotal({ ...emptyUsage() }));
  return {
    id: "s1",
    source: "claude-code",
    filePath: "/tmp/s1.jsonl",
    startedAt: 1000,
    endedAt: 1000 + turns.length,
    totals: { tokens: withTotal(tokens), durationMs: turns.length },
    turns,
  } as Session;
}

describe("SPEC-0031 R1 · anchorEvents", () => {
  it("captures full branch SHAs per commit turn, transcript order, commit verbs only", () => {
    const turns = [turn(0), turn(1, { commitSha: SHA_A }), turn(2, { push: SHA_B.slice(0, 12) }), turn(3, { commitSha: SHA_B })];
    const events = anchorEvents(turns, COMMITS.shas);
    expect(events).toEqual([
      { turnIndex: 1, shas: [SHA_A] },
      { turnIndex: 3, shas: [SHA_B] },
    ]);
  });
});

describe("SPEC-0031 R1 · segmentation", () => {
  it("partitions the slice at anchor boundaries, completely", () => {
    const turns = [turn(0), turn(1), turn(2), turn(3, { commitSha: SHA_A }), turn(4), turn(5), turn(6), turn(7, { commitSha: SHA_B })];
    const slice = computeSlice(turns, COMMITS.shas);
    expect(slice.kind).toBe("slice");
    const segs = segmentSlice(slice, anchorEvents(turns, COMMITS.shas), COMMITS);
    expect(segs.map((s) => [s.startTurn, s.endTurn, s.sha])).toEqual([
      [0, 3, SHA_A],
      [4, 7, SHA_B],
    ]);
  });

  it("folds a trailing own-push span into the last segment (partition stays complete)", () => {
    const turns = [turn(0), turn(1, { commitSha: SHA_A }), turn(2), turn(3, { push: `pushed ${SHA_A}` })];
    const slice = computeSlice(turns, COMMITS.shas);
    expect(slice).toMatchObject({ kind: "slice", endTurn: 3 });
    const segs = segmentSlice(slice, anchorEvents(turns, COMMITS.shas), COMMITS);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ startTurn: 0, endTurn: 3, sha: SHA_A });
  });

  it("multi-anchor turn goes to the chronologically earliest commit, extras counted", () => {
    const turns = [turn(0), turn(1, { commitShas: [SHA_B, SHA_A] })];
    const segs = segmentSlice(computeSlice(turns, COMMITS.shas), anchorEvents(turns, COMMITS.shas), COMMITS);
    expect(segs).toHaveLength(1);
    expect(segs[0].sha).toBe(SHA_A); // earliest, despite B printing first
    expect(segs[0].extraShas).toEqual([SHA_B]);
  });

  it("a re-printed SHA is not a boundary", () => {
    const turns = [turn(0, { commitSha: SHA_A }), turn(1, { commitSha: SHA_A }), turn(2, { commitSha: SHA_B })];
    const segs = segmentSlice(computeSlice(turns, COMMITS.shas), anchorEvents(turns, COMMITS.shas), COMMITS);
    expect(segs.map((s) => s.sha)).toEqual([SHA_A, SHA_B]);
    expect(segs[0].endTurn).toBe(0);
    expect(segs[1].startTurn).toBe(1);
  });

  it("full-fallback and anchorless sessions produce no segments (labeled bucket instead)", () => {
    const noAnchors = [turn(0), turn(1)];
    expect(segmentSlice(computeSlice(noAnchors, COMMITS.shas), anchorEvents(noAnchors, COMMITS.shas), COMMITS)).toEqual([]);
  });
});

describe("SPEC-0031 R2 · commit metadata", () => {
  it("parses NUL-delimited lines with hostile subjects (| and tab) intact", () => {
    const parsed = parseBranchCommitLine(`${SHA_A}\u0000` + "2026-07-03T00:00:00Z" + `\u0000fix: a|b\tc | d`);
    expect(parsed).toEqual({ sha: SHA_A, iso: "2026-07-03T00:00:00Z", subject: "fix: a|b\tc | d" });
  });

  it("caps displayed subjects at 72 codepoints", () => {
    const long = "x".repeat(100);
    const commits: BranchCommits = { shas: [SHA_A], commitMs: [1], subjects: [long] };
    const turns = [turn(0, { commitSha: SHA_A })];
    const segs = segmentSlice(computeSlice(turns, [SHA_A]), anchorEvents(turns, [SHA_A]), commits);
    expect([...segs[0].subject]).toHaveLength(SUBJECT_DISPLAY_CAP);
    expect(segs[0].subject.endsWith("…")).toBe(true);
  });
});

describe("SPEC-0031 R3 · surfaces", () => {
  it("renders table lines with the convention named, and tokens-only when unpriced (I2)", () => {
    const lines = renderPerCommitLines([
      { shortSha: "aaaa111", subject: "feat: first", turnCount: 3, usd: 0.12, totalTokens: 999, extraCount: 0 },
      { shortSha: "bbbb111", subject: "feat: second", turnCount: 1, usd: null, totalTokens: 4321, extraCount: 1 },
    ]);
    expect(lines[0]).toContain("$0.12");
    expect(lines[1]).toContain("4321 tokens");
    expect(lines[1]).toContain("(+1 more in this turn)");
    expect(lines[1]).not.toContain("$");
    expect(lines.at(-1)).toContain(PER_COMMIT_METHODOLOGY);
  });

  it("artifact embeds the table, the labeled bucket, and an inert template island — still script-free", async () => {
    const s = session([turn(0, { commitSha: SHA_A })]);
    const model = await buildReceiptModel(s);
    const input: ArtifactInput = {
      prNumber: 9,
      body: { contributors: [], excludedCount: 0 },
      sessions: [{ label: "builder · s1", model, perCommitLines: renderPerCommitLines([{ shortSha: "aaaa111", subject: "feat: first", turnCount: 1, usd: null, totalTokens: 5, extraCount: 0 }]) }],
      notAttributable: ["helper · s2"],
      perCommitJson: JSON.stringify([{ session: "s1", rows: [] }]),
    };
    const html = renderPrArtifactHtml(input);
    expect(html).toContain("aaaa111");
    expect(html).toContain(PER_COMMIT_METHODOLOGY);
    expect(html).toContain("not commit-attributable");
    expect(html).toContain('<template id="per-commit">');
    expect(html).not.toContain("<script");
  });

  it("hostile subject cannot break out of the template island; raw content stays valid JSON", () => {
    const json = JSON.stringify([{ session: "s1", rows: [{ subject: "</template><script>alert(1)</script> & co" }] }]);
    const html = renderPrArtifactHtml({
      prNumber: 9,
      body: { contributors: [], excludedCount: 0 },
      sessions: [],
      perCommitJson: json,
    });
    expect(html).not.toContain("<script");
    expect(html.match(/<\/template>/g)).toHaveLength(1);
    const inner = /<template id="per-commit">([\s\S]*?)<\/template>/.exec(html)![1];
    const parsed = JSON.parse(inner) as { rows: { subject: string }[] }[];
    expect(parsed[0].rows[0].subject).toContain("<script>alert(1)</script>");
  });

  it("fence and details renderers carry no per-commit content (frozen surfaces)", async () => {
    const { renderPrReceiptText } = await import("../../src/pr/body.js");
    const text = renderPrReceiptText({ contributors: [], excludedCount: 0 });
    expect(text).not.toContain(PER_COMMIT_METHODOLOGY);
    expect(text).not.toContain("per-commit");
  });
});

describe("SPEC-0031 R4 · ledger reconciliation property", () => {
  const arb = fc
    .record({
      turnTokens: fc.array(fc.record({ input: fc.integer({ min: 0, max: 9000 }), output: fc.integer({ min: 0, max: 2000 }) }), { minLength: 2, maxLength: 14 }),
      anchorAt: fc.uniqueArray(fc.integer({ min: 0, max: 13 }), { minLength: 1, maxLength: 4 }),
    })
    .map(({ turnTokens, anchorAt }) => {
      const anchors = anchorAt.filter((i) => i < turnTokens.length).sort((a, b) => a - b);
      const shas = anchors.map((_, k) => `${k.toString(16).padStart(4, "c")}111122223333444455556666777788889999`.slice(0, 40));
      const commits: BranchCommits = {
        shas: [...shas].reverse(),
        commitMs: shas.map((_, k) => 1000 + k),
        subjects: shas.map((_, k) => `c${k}`),
      };
      const turns = turnTokens.map((t, i) => {
        const k = anchors.indexOf(i);
        return turn(i, { commitSha: k >= 0 ? shas[k] : undefined, input: t.input, output: t.output });
      });
      return { turns, commits, hasAnchor: anchors.length > 0 };
    });

  it("segment sums equal the slice totals: tokens exact, USD within 1e-9", async () => {
    await fc.assert(
      fc.asyncProperty(arb, async ({ turns, commits, hasAnchor }) => {
        if (!hasAnchor) {
          return;
        }
        const slice = computeSlice(turns, commits.shas);
        if (slice.kind !== "slice") {
          return;
        }
        const segs = segmentSlice(slice, anchorEvents(turns, commits.shas), commits);
        // partition completeness: contiguous cover of [startTurn, endTurn]
        expect(segs[0].startTurn).toBe(slice.startTurn);
        expect(segs.at(-1)!.endTurn).toBe(slice.endTurn);
        for (let i = 1; i < segs.length; i++) {
          expect(segs[i].startTurn).toBe(segs[i - 1].endTurn + 1);
        }
        const s = session(turns);
        const rows = await buildPerCommitRows(s, segs);
        const sliceModel = await buildReceiptModel(
          (await import("../../src/receipt/model.js")).sliceSessionForReceipt(s, slice),
        );
        const st = sliceModel.totalTokens;
        const sliceTokens = st.input + st.output + st.cacheRead + st.cacheCreation;
        expect(rows.reduce((a, r) => a + r.totalTokens, 0)).toBe(sliceTokens);
        const segUsd = rows.reduce((a, r) => a + (r.usd ?? 0), 0);
        const sliceUsd = sliceModel.totalUsd ?? 0;
        expect(Math.abs(segUsd - sliceUsd)).toBeLessThan(1e-9);
      }),
      { numRuns: 60 },
    );
  });

  it("red path: dropping a turn from a segment breaks token reconciliation", async () => {
    const turns = [turn(0, { input: 100, output: 10 }), turn(1, { input: 200, output: 20, commitSha: SHA_A })];
    const slice = computeSlice(turns, COMMITS.shas);
    const segs = segmentSlice(slice, anchorEvents(turns, COMMITS.shas), COMMITS);
    const broken = [{ ...segs[0], startTurn: 1 }]; // drops turn 0
    const s = session(turns);
    const rows = await buildPerCommitRows(s, broken);
    const full = await buildReceiptModel(s);
    const ft = full.totalTokens;
    expect(rows.reduce((a, r) => a + r.totalTokens, 0)).not.toBe(ft.input + ft.output + ft.cacheRead + ft.cacheCreation);
  });
});
