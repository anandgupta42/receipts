// R5: the shared aggregateWaste primitive. Verifies the three properties the
// digest and SPEC-0013 rely on: cost is a priced-subset sum (unpriced firings
// contribute tokens, never a guessed dollar); distinctSessionCount counts a
// session once no matter how many times a class fired in it; rows order desc
// by cost so "top-3 by cost" is a plain slice. Uses the real committed price
// table so every dollar traces to a cited row.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { aggregateWaste } from "../../src/aggregate/waste.js";
import { detectStuckLoops } from "../../src/pricing/waste.js";
import type { Session, SessionTotals, TokenUsage, ToolCall, Turn } from "../../src/parse/types.js";

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/prices");
const TS = Date.UTC(2026, 5, 15, 10, 0, 0);

function usage(input: number, output = 0): TokenUsage {
  return { input, output, cacheRead: 0, cacheCreation: 0, total: input + output };
}
function totals(t: TokenUsage): SessionTotals {
  return { tokens: t, turnCount: 1, toolCallCount: 0 };
}
function session(id: string, turns: Turn[], over: Partial<Session> = {}): Session {
  return {
    id,
    source: "claude-code",
    filePath: `/fake/${id}.jsonl`,
    totals: totals(usage(0)),
    turns,
    ...over,
  };
}
function call(name: string, input: unknown): ToolCall {
  return { name, input };
}

function loopTurn(input: number, calls: ToolCall[], model = "claude-haiku-4-5"): Turn {
  return { index: 0, timestamp: TS, model, usage: usage(input), toolCalls: calls };
}

const trivialTurn: Turn = {
  index: 0,
  timestamp: TS,
  model: "claude-sonnet-5",
  outputTokens: 50,
  usage: usage(100, 50),
  toolCalls: [],
};

describe("aggregateWaste (R5)", () => {
  it("counts a session once in distinctSessionCount even when a class fires twice, and sums both firings' cost", async () => {
    // Two separate 3-runs interrupted by an `edit` call → two stuck-loop findings, one session.
    const turn = loopTurn(6_000_000, [
      call("bash", { cmd: "x" }),
      call("bash", { cmd: "x" }),
      call("bash", { cmd: "x" }),
      call("edit", { cmd: "x" }),
      call("bash", { cmd: "x" }),
      call("bash", { cmd: "x" }),
      call("bash", { cmd: "x" }),
    ]);
    const s = session("two-loops", [turn]);
    const loops = await detectStuckLoops(s, dataDir);
    expect(loops).toHaveLength(2);

    const agg = await aggregateWaste([s], dataDir);
    const sl = agg.find((a) => a.class === "stuck-loop");
    expect(sl).toBeDefined();
    expect(sl?.distinctSessionCount).toBe(1);
    expect(sl?.cost).toBeCloseTo(loops.reduce((n, l) => n + (l.usd ?? 0), 0), 10);
  });

  it("counts distinct sessions across the window", async () => {
    const mk = (id: string) =>
      session(id, [loopTurn(3_000_000, [call("bash", { cmd: "y" }), call("bash", { cmd: "y" }), call("bash", { cmd: "y" })])]);
    const agg = await aggregateWaste([mk("a"), mk("b")], dataDir);
    const sl = agg.find((a) => a.class === "stuck-loop");
    expect(sl?.distinctSessionCount).toBe(2);
  });

  it("keeps cost at 0 but accumulates tokens for an unpriced (unpriceable) firing — never a guessed dollar", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: TS,
      usage: usage(3_000_000),
      toolCalls: [call("bash", { cmd: "z" }), call("bash", { cmd: "z" }), call("bash", { cmd: "z" })],
    };
    const agg = await aggregateWaste([session("cursor", [turn], { unpriceable: true })], dataDir);
    const sl = agg.find((a) => a.class === "stuck-loop");
    expect(sl).toBeDefined();
    expect(sl?.cost).toBe(0);
    expect(sl?.tokens.total).toBeGreaterThan(0);
  });

  it("orders classes desc by cost so top-N is a slice; a session firing nothing contributes nothing", async () => {
    const loopSession = session("loops", [
      loopTurn(6_000_000, [call("bash", { cmd: "x" }), call("bash", { cmd: "x" }), call("bash", { cmd: "x" })]),
    ]);
    const trivialSession = session("trivial", [trivialTurn]);
    const cleanSession = session("clean", [
      { index: 0, timestamp: TS, model: "claude-sonnet-5", usage: usage(10, 10), toolCalls: [call("bash", { cmd: "once" })] },
    ]);

    const agg = await aggregateWaste([trivialSession, loopSession, cleanSession], dataDir);
    expect(agg.map((a) => a.class)).toEqual(["stuck-loop", "trivial-spans"]);
    expect(agg[0].cost).toBeGreaterThan(agg[1].cost);
  });

  it("returns [] when no session fires a class", async () => {
    const clean = session("clean", [
      { index: 0, timestamp: TS, model: "claude-sonnet-5", usage: usage(1000, 500), toolCalls: [call("bash", { cmd: "a" })] },
    ]);
    expect(await aggregateWaste([clean], dataDir)).toEqual([]);
  });
});

describe("aggregateWaste — SPEC-0017 R6 (context-thrash + non-additive overlap)", () => {
  function thrashTurn(index: number, pS: number, calls: ToolCall[] = []): Turn {
    return { index, timestamp: TS, model: "claude-haiku-4-5", usage: usage(pS), toolCalls: calls };
  }

  it("emits a context-thrash class row that is additive when it shares no turn with another class", async () => {
    const turns = [
      thrashTurn(0, 100_000),
      thrashTurn(1, 200_000),
      thrashTurn(2, 180_000),
      thrashTurn(3, 170_000),
      thrashTurn(4, 175_000),
      thrashTurn(5, 165_000),
      thrashTurn(6, 190_000),
    ];
    const s = session("thrash-only", turns, { compactions: [{ turnIndex: 2 }, { turnIndex: 4 }] });
    const agg = await aggregateWaste([s], dataDir);
    const ct = agg.find((a) => a.class === "context-thrash");
    expect(ct).toBeDefined();
    expect(ct?.distinctSessionCount).toBe(1);
    expect(ct?.nonAdditive).toBeUndefined();
    expect(ct?.overlapsWith).toBeUndefined();
  });

  it("marks both classes non-additive when a context-thrash turn is also a stuck-loop turn", async () => {
    const loop: ToolCall[] = [call("bash", { cmd: "x" }), call("bash", { cmd: "x" }), call("bash", { cmd: "x" })];
    const turns = [
      thrashTurn(0, 200_000),
      thrashTurn(1, 180_000),
      thrashTurn(2, 185_000),
      thrashTurn(3, 170_000),
      thrashTurn(4, 175_000, loop), // contributing thrash turn AND a stuck-loop run
      thrashTurn(5, 165_000),
      thrashTurn(6, 190_000),
    ];
    const s = session("overlap", turns, { compactions: [{ turnIndex: 2 }, { turnIndex: 4 }] });
    const agg = await aggregateWaste([s], dataDir);
    const ct = agg.find((a) => a.class === "context-thrash");
    const sl = agg.find((a) => a.class === "stuck-loop");
    expect(ct?.nonAdditive).toBe(true);
    expect(ct?.overlapsWith).toEqual(["stuck-loop"]);
    expect(sl?.nonAdditive).toBe(true);
    expect(sl?.overlapsWith).toEqual(["context-thrash"]);
  });
});
