// SPEC-0019 R1e — end-to-end slicing over adapter-parsed fixtures: classification
// (own/foreign/input-only/no-SHA), the foreign-anchor window (multi-PR cut), and
// the fallbacks (no anchor; push-only rebase; codex-exec wrapper not claimed).
import { fileURLToPath } from "node:url";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/parse/load.js";
import type { Session, ToolCall, Turn } from "../../src/parse/types.js";
import { computeSlice, FULL_FALLBACK_LABEL } from "../../src/pr/slice.js";
import { hexRuns, matchesBranchSha, toolCallGitVerb } from "../../src/pr/gitWrite.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "pr");

// Branch B's commit + push heads — "ours" for claude-anchors.jsonl.
const OUR_SHAS = ["b1c2d3e4f5061728394a5b6c7d8e9f0011223344", "c9d8e7f6a5b4c3d2e1f00918273645546372819a"];
const PROPERTY_OWN = "aaaaaaaa11111111222222223333333344444444";
const PROPERTY_ORPHAN = "bbbbbbbb11111111222222223333333344444444";
const PROPERTY_FOREIGN = "cccccccc11111111222222223333333344444444";

function propertyTurn(index: number, sha?: string, amend = false): Turn {
  return {
    index,
    toolCalls:
      sha === undefined
        ? []
        : [{
            name: "Bash",
            shell: true,
            input: { command: `git commit ${amend ? "--amend " : ""}-m turn-${index}` },
            output: `[branch ${sha.slice(0, 7)}] turn-${index}`,
            status: "ok",
          }],
  };
}

function gitCall(session: Session, turnIndex: number): ToolCall {
  const call = session.turns[turnIndex].toolCalls.find((c) => toolCallGitVerb(c) !== null);
  if (!call) {
    throw new Error(`no git-write call in turn ${turnIndex}`);
  }
  return call;
}

/** own iff a hex in OUTPUT matches ours; foreign iff hexes present but none ours; null iff no hex. */
function classify(call: ToolCall): "own" | "foreign" | "none" {
  const runs = hexRuns(String(call.output ?? ""));
  if (runs.length === 0) {
    return "none";
  }
  return runs.some((r) => matchesBranchSha(r, OUR_SHAS)) ? "own" : "foreign";
}

describe("R1e classification over adapter-parsed output", () => {
  it("classifies each commit/push span per (b)-(d)", async () => {
    const session = (await loadById("claude-code", path.join(FIX, "claude-anchors.jsonl")))!;
    expect(session).toBeTruthy();
    expect(classify(gitCall(session, 0))).toBe("foreign"); // commit A — SHA not ours
    expect(classify(gitCall(session, 2))).toBe("own"); // commit B — b1c2d3e
    expect(classify(gitCall(session, 3))).toBe("own"); // push — b1c2d3e..c9d8e7f
    // push whose INPUT carries our full SHA but OUTPUT carries only foreign hexes:
    // authorship is output-only, so this is foreign, never own.
    expect(classify(gitCall(session, 4))).toBe("foreign");
    expect(classify(gitCall(session, 5))).toBe("none"); // empty commit — no SHA in output
  });
});

describe("R1e slice + foreign window", () => {
  it("slices from after the sibling's anchor through our last own anchor", async () => {
    const session = (await loadById("claude-code", path.join(FIX, "claude-anchors.jsonl")))!;
    const slice = computeSlice(session.turns, OUR_SHAS);
    // foreign commit A at turn 0 → start at 1; last own anchor is the push at turn 3.
    expect(slice).toEqual({ kind: "slice", startTurn: 1, endTurn: 3, turnCount: 6 });
  });

  it("with no foreign anchor before, slices from the session start", async () => {
    const session = (await loadById("claude-code", path.join(FIX, "claude-anchors.jsonl")))!;
    // Treat A's SHA as ours too → no foreign anchor before the first own.
    const slice = computeSlice(session.turns, [...OUR_SHAS, "a1a1a1a0000000000000000000000000000000f"]);
    expect(slice.kind).toBe("slice");
    expect(slice.startTurn).toBe(0);
    expect(slice.endTurn).toBe(3);
  });

  it("property: a recovered alias slices exactly like its canonical branch SHA", () => {
    const kinds = fc.array(fc.constantFrom("alias", "own", "foreign", "none"), { minLength: 1, maxLength: 30 })
      .filter((values) => values.includes("alias"));
    fc.assert(
      fc.property(kinds, (values) => {
        const aliasTurns = values.map((kind, index) =>
          propertyTurn(index, kind === "alias" ? PROPERTY_ORPHAN : kind === "own" ? PROPERTY_OWN : kind === "foreign" ? PROPERTY_FOREIGN : undefined),
        );
        const canonicalTurns = values.map((kind, index) =>
          propertyTurn(index, kind === "alias" || kind === "own" ? PROPERTY_OWN : kind === "foreign" ? PROPERTY_FOREIGN : undefined),
        );

        expect(computeSlice(aliasTurns, [PROPERTY_OWN], new Map([[PROPERTY_ORPHAN.slice(0, 7), PROPERTY_OWN]]))).toEqual(
          computeSlice(canonicalTurns, [PROPERTY_OWN]),
        );
      }),
      { numRuns: 100 },
    );
  });

  it("walks a repeated content-changing amend chain back to the original commit", () => {
    const secondOrphan = "dddddddd11111111222222223333333344444444";
    const turns = [
      propertyTurn(0),
      propertyTurn(1, PROPERTY_ORPHAN),
      propertyTurn(2, secondOrphan, true),
      propertyTurn(3, PROPERTY_OWN, true),
    ];

    expect(computeSlice(turns, [PROPERTY_OWN])).toEqual({
      kind: "slice",
      startTurn: 0,
      endTurn: 3,
      turnCount: 4,
    });
  });
});

describe("R1e fallbacks (ambiguity → labeled full session)", () => {
  it("no own anchor at all → full session", async () => {
    const session = (await loadById("claude-code", path.join(FIX, "claude-anchors.jsonl")))!;
    const slice = computeSlice(session.turns, ["deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"]);
    expect(slice.kind).toBe("full");
    expect(slice.label).toBe(FULL_FALLBACK_LABEL);
  });

  it("push-only own anchor after a rebase → full session (stale-anchor rule)", async () => {
    const session = (await loadById("claude-code", path.join(FIX, "claude-pushonly-rebase.jsonl")))!;
    const slice = computeSlice(session.turns, ["ffee5670123456789abcdef0123456789abcdef0"]);
    expect(slice.kind).toBe("full");
    expect(slice.label).toBe(FULL_FALLBACK_LABEL);
  });

  it("`codex exec \"…git push…\"` is not claimed even when the output SHA is ours", async () => {
    const session = (await loadById("codex", path.join(FIX, "codex-exec-instruction.jsonl")))!;
    const slice = computeSlice(session.turns, ["d4d4d4d4e5e5e5e5f6f6f6f60000000000000000"]);
    expect(slice.kind).toBe("full");
  });

  // SPEC-0044 M3 — pin the full-fallback boundary EXACTLY (not just kind/label):
  // the fallback must span the whole session, turn 0 through turnCount-1. This
  // kills the `Math.max(0, turnCount - 1)` mutants (→ `Math.min`, → `+ 1`) that
  // survived because the other fallback tests only checked `.kind`.
  it("full fallback spans the entire session: startTurn 0, endTurn turnCount-1", async () => {
    const session = (await loadById("claude-code", path.join(FIX, "claude-anchors.jsonl")))!;
    const n = session.turns.length;
    expect(n).toBeGreaterThan(1); // guard: turnCount-1 must differ from 0 and from turnCount+1
    const slice = computeSlice(session.turns, []); // no branch SHAs → no own anchor → full
    expect(slice).toEqual({ kind: "full", startTurn: 0, endTurn: n - 1, turnCount: n, label: FULL_FALLBACK_LABEL });
  });
});
