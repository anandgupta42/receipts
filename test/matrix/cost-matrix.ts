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
  /** Exact USD independently calculated from raw tokens × cited price rows. */
  expectedUsd?: number;
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
    // events: two priced turns (a-0004, a-0018, both claude-opus-4-8/
    // claude-sonnet-5) carry a flat cache_creation_input_tokens with no nested
    // 5m/1h split object — but the A3 trigger is row-aware, not usage-only:
    // data/prices/anthropic.json cites input_cache_write_5m for both models, so
    // the unsplit remainder still prices at that cited rate exactly. No
    // fallback to base `input` occurs, so this hero session must NOT caveat.
    expected: {
      unpriceable: false,
      priced: true,
      expectedUsd: 0.1767,
      rawTokens: { input: 19680, output: 897, cacheRead: 124200, cacheCreation: 2100 },
    },
  },
  "clean-multi-tool::codex": {
    fixture: `${f}/codex/clean-session.jsonl`,
    // Raw input_tokens=9,800 includes cached_input_tokens=6,100, so the
    // billable uncached input oracle is 3,700. gpt-5.3-codex's cited rates
    // (1.75 / .175 / 14 per million) produce exactly $0.0165025.
    expected: {
      unpriceable: false,
      priced: true,
      expectedUsd: 0.0165025,
      rawTokens: { input: 3700, output: 640, cacheRead: 6100, cacheCreation: 0 },
    },
  },
  "clean-multi-tool::opencode": {
    fixture: `${f}/opencode/clean-multi-vendor.db`,
    // events: two priced turns with cache-write — claude-haiku-4-5 (anthropic,
    // cache.write: 40, cited 5m rate → prices exactly) and gpt-5.3-codex
    // (openai, cache.write: 50, data/prices/openai.json cites NO
    // input_cache_write_5m/1h → falls back to base input). The row-aware
    // trigger fires because of the openai turn specifically, not because
    // opencode lacks a split-tier concept in general.
    expected: {
      unpriceable: false,
      priced: true,
      expectedUsd: 0.00975625,
      rawTokens: { input: 2200, output: 700, cacheRead: 150, cacheCreation: 90 },
      events: ["cost-lower-bound-cache-tier"],
    },
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
    // The only priced turn (claude-haiku-4-5, cache.write: 40) prices against
    // Anthropic's cited input_cache_write_5m rate exactly — no fallback, no
    // caveat. (The other turn, local-big-pickle/local, is the unpriced one and
    // never reaches cacheWriteIsLowerBound at all.)
    expected: { unpriceable: false, priced: true },
  },
  "unpriced-model::cursor": {
    fixture: "cursor:unpriceable",
    // Cursor is the canonical always-tokens-only case.
    expected: { unpriceable: true, priced: false },
  },

  // ---- cache-tier-fallback (A3) ----
  "cache-tier-fallback::claude-code": {
    fixture: `${f}/claude-code/cache-tier-fallback-unsplit.jsonl`,
    // A single priced turn (a-2002, gpt-5.4-mini) carries a flat
    // cache_creation_input_tokens: 2000 with NO nested 5m/1h split object.
    // The trigger is row-aware: data/prices/openai.json cites NO
    // input_cache_write_5m/1h for gpt-5.4-mini, so this unsplit remainder
    // falls back to the base `input` rate — a genuine lower bound. The model
    // is deliberately NOT Anthropic — an unsplit write against a row that DOES
    // cite the 5m rate (e.g. claude-opus-4-8) prices exactly and must NOT
    // caveat (see the "does NOT flag ... for an unsplit cache-write when the
    // vendor cites the 5m rate" case in test/pricing/attribution.test.ts). A
    // sibling fixture (cache-tier-fallback-split.jsonl, an Anthropic session
    // with both tiers split and cited) is the negative control — see
    // test/pricing/attribution.test.ts and the e2e cache-tier-caveat tests.
    expected: {
      unpriceable: false,
      priced: true,
      rawTokens: { input: 800, output: 180, cacheRead: 1800, cacheCreation: 2000 },
      events: ["cost-lower-bound-cache-tier"],
    },
  },
  "cache-tier-fallback::codex": na("Codex has no cache-write pricing concept (cached_input is read-only) — the tier-fallback scenario cannot occur."),
  "cache-tier-fallback::opencode": {
    fixture: `${f}/opencode/clean-multi-vendor.db`,
    // opencode's schema exposes only a flat tokens.cache.write with no tier
    // concept at all (src/parse/opencode.ts never sets cacheCreation5m/1h), so
    // every opencode cache-write turn takes the unsplit-remainder path — but
    // whether that's a caveat still depends on the row: this fixture's
    // gpt-5.3-codex turn (openai, cache.write: 50) has no cited
    // input_cache_write_5m/1h and falls back to base input (the trigger); its
    // claude-haiku-4-5 turn (cache.write: 40) prices exactly against
    // Anthropic's cited 5m rate and would NOT caveat on its own. Reusing
    // clean-multi-vendor.db rather than authoring a redundant new .db fixture.
    expected: { unpriceable: false, priced: true, events: ["cost-lower-bound-cache-tier"] },
  },
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
    // events: same A3 ground truth as the cache-tier-fallback and
    // clean-multi-tool cells that reuse this fixture — the gpt-5.3-codex turn's
    // cache-write falls back to base input (openai cites no cache-write rate),
    // a genuine lower bound; the claude-haiku-4-5 turn prices exactly.
    expected: { unpriceable: false, priced: true, events: ["cost-lower-bound-cache-tier"] },
  },
  "multi-vendor-session::cursor": na("Cursor records no per-turn vendor; unpriceable."),
};

export function cellKey(scenario: Scenario, agent: AgentSource): string {
  return `${scenario}::${agent}`;
}
