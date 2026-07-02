/**
 * Normalized session-trace model shared by every adapter and by `src/pricing/**`
 * and `src/receipt/**`. An adapter reads an agent's on-disk session files and maps
 * them onto these shapes so downstream code works the same regardless of which
 * agent produced the session.
 *
 * Trimmed for M1 scope (SPEC-0001, agent team config): three sources only
 * (claude-code, codex, cursor); no receipt/attestation/store concepts; a
 * turn-based (not per-message) session shape, since pricing/attribution/waste
 * detection all reason in terms of one assistant turn's usage + tool calls.
 */

export type AgentSource = "claude-code" | "codex" | "cursor";

export const SOURCE_LABELS: Record<AgentSource, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
};

/**
 * input/output/cacheRead only — the price schema (`data/prices/<vendor>.json`)
 * carries no cache-write rate, so adapters fold any cache-write tokens into
 * `input` at parse time (a defensible cited-rate proxy) rather than inventing a
 * fourth bucket nothing can price (I2). See each adapter's `mapUsage` for the
 * exact per-vendor mapping and rationale.
 */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  total: number;
}

export type ToolCallStatus = "ok" | "error" | "running";

export interface ToolCall {
  name: string;
  input?: unknown;
  output?: unknown;
  status?: ToolCallStatus;
  /** epoch milliseconds. Never synthesized — only set when the transcript
   * records a real timestamp for this call's start/end (R4a needs true
   * wall-clock, not fabricated precision). */
  startedAt?: number;
  endedAt?: number;
}

/** One assistant turn: its text/thinking is not modeled (not needed by pricing,
 * attribution, or waste detection) — only what those consumers need: usage,
 * model, timing, and the tool calls issued during the turn. */
export interface Turn {
  index: number;
  /** epoch milliseconds */
  timestamp?: number;
  model?: string;
  usage?: TokenUsage;
  /** approximate output token count for this turn, when known independently of
   * `usage.output` (e.g. before usage is attached) — used by the R4b trivial-span
   * detector's "output <= 120 tokens" eligibility check. Equal to
   * `usage.output` whenever `usage` is present. */
  outputTokens?: number;
  toolCalls: ToolCall[];
}

export interface SessionTotals {
  tokens: TokenUsage;
  durationMs?: number;
  turnCount: number;
  toolCallCount: number;
}

/** Lightweight row for the session list — no turn bodies. */
export interface SessionSummary {
  /** adapter-local id; for file-based adapters this is the absolute file path */
  id: string;
  source: AgentSource;
  title?: string;
  model?: string;
  /** epoch milliseconds */
  startedAt?: number;
  endedAt?: number;
  totals: SessionTotals;
  filePath: string;
  /** true when this source's transcript format cannot support priced per-tool
   * attribution (Cursor in M1 — R1): no per-turn model id or usage breakdown.
   * Pricing/attribution/waste code must skip sessions with this flag set and
   * the receipt renders a tokens-only note instead (I2). */
  unpriceable?: boolean;
}

export interface Session extends SessionSummary {
  turns: Turn[];
}

export interface SessionAdapter {
  readonly id: AgentSource;
  /** human label, e.g. "Claude Code" */
  readonly label: string;
  /** directories this adapter reads — used for detection */
  roots(): string[];
  /** true when any session data is present on disk */
  detect(): Promise<boolean>;
  /** session rows for the list; should be cheap-ish and resilient to bad data */
  listSessions(): Promise<SessionSummary[]>;
  /** full session (with turns) by its adapter-local id */
  loadSession(id: string): Promise<Session | null>;
}
