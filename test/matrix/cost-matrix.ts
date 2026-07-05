// SPEC-0044 R3/R4 — the scenario × agent cost matrix, declarative.
//
// Every populated cell names a real fixture and a HAND-AUTHORED `expected`
// manifest. The manifest is authored from first principles / the fixture's raw
// bytes — NEVER read back from the parser or pricer under test (oracle
// independence; a matrix that asserts the code agrees with itself is worthless,
// per the Codex spec review). Where an exact total-token count is pinned, it
// was computed by summing the fixture's raw usage fields independently of the
// adapter (see the `rawTokens` note per cell).
//
// A cell an agent cannot structurally produce is `na` with a non-empty reason.
// `completeness.test.ts` fails CI if any (scenario, agent) pair is neither
// populated nor `na` — so adding a scenario row or an agent column without
// covering the new cells breaks the build (the durable regression guard).

import type { AgentSource } from "../../src/parse/types.js";

export const AGENTS = ["claude-code", "codex", "opencode", "cursor"] as const satisfies readonly AgentSource[];

/** The taxonomy scenarios (docs/internal/cost-attribution-evidence.md). */
export const SCENARIOS = [
  "clean-multi-tool",
  "stuck-loop",
  "context-thrash",
  "trivial-spans",
  "unpriced-model",
  "cache-tier-fallback",
  "reasoning-tokens",
  "multi-vendor-session",
] as const;

export type Scenario = (typeof SCENARIOS)[number];

/** What the receipt must show for a cell — invariants, not code-derived values. */
export interface CellExpectation {
  /** Cursor's degraded mode: no per-turn model/usage. */
  unpriceable: boolean;
  /** Does the session price to a `$` total, or render tokens-only (I2)? */
  priced: boolean;
  /** Waste kinds the scenario must surface (scenario-derived). */
  waste?: ReadonlyArray<"stuck-loop" | "context-thrash" | "trivial-spans">;
  /** ConfidenceEvent kinds the receipt must carry for this cell. */
  events?: ReadonlyArray<string>;
  /** Exact total input/output tokens, summed independently from the fixture's
   *  raw bytes (NOT via the adapter). Pins the arithmetic + powers the red path. */
  rawTokens?: { input: number; output: number; cacheRead: number; cacheCreation: number };
}

export type Cell =
  | { fixture: string; expected: CellExpectation }
  | { na: string };

function na(reason: string): { na: string } {
  return { na: reason };
}

const f = "test/fixtures";

// The matrix. Keys are `${scenario}::${agent}`.
export const MATRIX: Record<string, Cell> = {
  // ---- clean-multi-tool: a normal priced session ----
  "clean-multi-tool::claude-code": {
    fixture: `${f}/claude-code/clean-multi-tool-2-models.jsonl`,
    // rawTokens: Σ per-turn input_tokens/output_tokens summed straight from the
    // fixture's raw JSONL (independent of the adapter) — the oracle for the
    // total-token arithmetic and the red path.
    expected: { unpriceable: false, priced: true, rawTokens: { input: 19680, output: 897, cacheRead: 124200, cacheCreation: 2100 } },
  },
  "clean-multi-tool::codex": {
    fixture: `${f}/codex/clean-session.jsonl`,
    expected: { unpriceable: false, priced: true },
  },
  "clean-multi-tool::opencode": {
    fixture: `${f}/opencode/clean-multi-vendor.db`,
    expected: { unpriceable: false, priced: true },
  },
  "clean-multi-tool::cursor": na("Cursor records session totals only — 'clean multi-tool' priced anatomy is unpriceable by construction; covered by the unpriceable cell."),

  // ---- stuck-loop ----
  "stuck-loop::claude-code": {
    fixture: `${f}/claude-code/loop-bash-5x.jsonl`,
    expected: { unpriceable: false, priced: true, waste: ["stuck-loop"] },
  },
  "stuck-loop::codex": {
    fixture: `${f}/codex/loop-exec-3x.jsonl`,
    expected: { unpriceable: false, priced: true, waste: ["stuck-loop"] },
  },
  "stuck-loop::opencode": {
    fixture: `${f}/opencode/loop-shell-3x.db`,
    expected: { unpriceable: false, priced: true, waste: ["stuck-loop"] },
  },
  "stuck-loop::cursor": na("Cursor's degraded bubble model exposes no per-tool-call structure to detect a loop; unpriceable."),

  // ---- context-thrash / compaction ----
  "context-thrash::claude-code": {
    fixture: `${f}/claude-code/context-thrash-3x.jsonl`,
    expected: { unpriceable: false, priced: true, waste: ["context-thrash"] },
  },
  "context-thrash::codex": {
    fixture: `${f}/codex/compactions-thrash.jsonl`,
    expected: { unpriceable: false, priced: true, waste: ["context-thrash"] },
  },
  "context-thrash::opencode": na("The opencode adapter recognizes no compaction signal — a documented visibility gap (evidence note), not a fixture we can author truthfully."),
  "context-thrash::cursor": na("No compaction signal; unpriceable."),

  // ---- trivial-spans ----
  "trivial-spans::claude-code": {
    fixture: `${f}/claude-code/trivial-spans-quick-qa.jsonl`,
    expected: { unpriceable: false, priced: true, waste: ["trivial-spans"] },
  },
  "trivial-spans::codex": {
    fixture: `${f}/codex/trivial-spans-r4b.jsonl`,
    expected: { unpriceable: false, priced: true, waste: ["trivial-spans"] },
  },
  "trivial-spans::opencode": na("No opencode trivial-span fixture authored this pass — cell reserved (completeness guard tracks it)."),
  "trivial-spans::cursor": na("Cursor has no per-turn output-token count to threshold a trivial span; unpriceable."),

  // ---- unpriced-model: an unknown model → tokens-only, never a guessed $ (I2) ----
  "unpriced-model::claude-code": {
    fixture: `${f}/claude-code/unpriced-unknown-model.jsonl`,
    expected: { unpriceable: false, priced: false },
  },
  "unpriced-model::codex": na("No unpriced-model codex fixture this pass; the invariant (unknown model → tokens-only) is agent-agnostic and covered by the claude-code + opencode cells."),
  "unpriced-model::opencode": {
    fixture: `${f}/opencode/mixed-known-unknown.db`,
    // A mixed session: known vendors price, unknown models stay tokens-only.
    expected: { unpriceable: false, priced: true },
  },
  "unpriced-model::cursor": {
    fixture: "cursor:unpriceable",
    // Cursor is the canonical always-tokens-only case.
    expected: { unpriceable: true, priced: false },
  },

  // ---- cache-tier-fallback (A3) ----
  "cache-tier-fallback::claude-code": na("A3 emitter (cost-lower-bound-cache-tier) is declared in the ConfidenceEvent union but not yet wired through the Stryker-gated pricing path — deferred to its own build; cell reserved."),
  "cache-tier-fallback::codex": na("Codex has no cache-write pricing concept (cached_input is read-only) — the tier-fallback scenario cannot occur."),
  "cache-tier-fallback::opencode": na("opencode reports a flat cache-write with no tier — the fallback applies but A3's emitter is deferred; cell reserved."),
  "cache-tier-fallback::cursor": na("No cache stats at all; unpriceable."),

  // ---- reasoning-tokens (C1: codex fold had no test) ----
  "reasoning-tokens::claude-code": na("Anthropic doesn't expose a separate reasoning-token count — thinking is inside output_tokens already; no distinct bucket to fold."),
  "reasoning-tokens::codex": {
    fixture: `${f}/codex/compactions-2x.jsonl`,
    // compactions-2x carries reasoning_output_tokens; it must land in output.
    expected: { unpriceable: false, priced: true },
  },
  "reasoning-tokens::opencode": na("opencode's reasoning fold is already tested end-to-end in test/parse/opencode.test.ts (100-session sim); not re-fixtured here."),
  "reasoning-tokens::cursor": na("No reasoning tokens; unpriceable."),

  // ---- multi-vendor-session (opencode's defining property) ----
  "multi-vendor-session::claude-code": na("Claude Code is single-vendor (Anthropic); multi-vendor within one session is opencode-specific."),
  "multi-vendor-session::codex": na("Codex is single-vendor (OpenAI)."),
  "multi-vendor-session::opencode": {
    fixture: `${f}/opencode/clean-multi-vendor.db`,
    expected: { unpriceable: false, priced: true },
  },
  "multi-vendor-session::cursor": na("Cursor records no per-turn vendor; unpriceable."),
};

export function cellKey(scenario: Scenario, agent: AgentSource): string {
  return `${scenario}::${agent}`;
}
