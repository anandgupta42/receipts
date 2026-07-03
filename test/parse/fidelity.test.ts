// SPEC-0028 R2 — per-adapter fidelity validators. Codex: summed per-turn
// usage must equal the rollout's own final cumulative envelope EXACTLY
// (same stream → tolerance 0). Claude Code: usage-shape invariants provable
// from the normalized Session. Registry seam: validators hang off each
// adapter; shared code never branches on agent type.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { adapterFor, agentIds } from "../../src/parse/registry.js";
import { loadById } from "../../src/parse/load.js";
import { claudeCodeFidelity } from "../../src/parse/fidelity/claudeCode.js";
import { codexFidelity } from "../../src/parse/fidelity/codex.js";
import type { Session, Turn } from "../../src/parse/types.js";
import { emptyUsage, withTotal } from "../../src/parse/util.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "codex");

function claudeSession(turns: Turn[]): Session {
  return {
    id: "s",
    source: "claude-code",
    filePath: "s.jsonl",
    startedAt: 1000,
    endedAt: 2000,
    totals: { tokens: emptyUsage(), turnCount: turns.length, toolCallCount: 0 },
    turns,
  };
}

function usageTurn(index: number, over: Partial<Turn> = {}): Turn {
  return {
    index,
    timestamp: 1000 + index,
    usage: withTotal({ ...emptyUsage(), input: 100, output: 10 }),
    toolCalls: [],
    ...over,
  };
}

describe("codex fidelity (envelope self-consistency)", () => {
  it("reconciles a real cumulative-envelope rollout exactly", async () => {
    const session = (await loadById("codex", path.join(FIX, "clean-session.jsonl")))!;
    expect(codexFidelity.validate(session)).toEqual([]);
  });

  it("flags a one-token drift between summed turns and the cumulative envelope", async () => {
    const session = (await loadById("codex", path.join(FIX, "reconcile-drift.jsonl")))!;
    const findings = codexFidelity.validate(session);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.check === "codex-envelope")).toBe(true);
    // The delta is named so the maintainer can act on it, not just see red.
    expect(findings.map((f) => f.detail).join("\n")).toContain("output");
  });
});

describe("claude-code fidelity (usage-shape invariants)", () => {
  it("passes a clean constructed session", () => {
    expect(claudeCodeFidelity.validate(claudeSession([usageTurn(0), usageTurn(1)]))).toEqual([]);
  });

  it("flags a negative component", () => {
    const bad = usageTurn(0);
    bad.usage = { ...bad.usage!, input: -5 };
    const findings = claudeCodeFidelity.validate(claudeSession([bad]));
    expect(findings.some((f) => f.check === "claude-negative-component")).toBe(true);
  });

  it("flags total != component sum", () => {
    const bad = usageTurn(0);
    bad.usage = { ...bad.usage!, total: bad.usage!.total + 7 };
    const findings = claudeCodeFidelity.validate(claudeSession([bad]));
    expect(findings.some((f) => f.check === "claude-total-mismatch")).toBe(true);
  });

  it("flags a timestamp regression between turns", () => {
    const findings = claudeCodeFidelity.validate(
      claudeSession([usageTurn(0, { timestamp: 5000 }), usageTurn(1, { timestamp: 4000 })]),
    );
    expect(findings.some((f) => f.check === "claude-time-regression")).toBe(true);
  });
});

describe("registry seam (SPEC-0028 architecture directive)", () => {
  it("exposes fidelity through the adapter registry, per agent", () => {
    expect(adapterFor("codex")?.fidelity).toBe(codexFidelity);
    expect(adapterFor("claude-code")?.fidelity).toBe(claudeCodeFidelity);
    for (const id of ["cursor", "opencode", "gemini"] as const) {
      expect(adapterFor(id)?.fidelity).toBeUndefined();
    }
  });

  it("exposes vendor through the adapter registry (the retired switch's mapping, unchanged)", () => {
    const byId = Object.fromEntries(agentIds().map((id) => [id, adapterFor(id)?.vendor]));
    expect(byId).toEqual({
      "claude-code": "anthropic",
      codex: "openai",
      gemini: "google",
      cursor: undefined,
      opencode: undefined,
    });
  });
});
