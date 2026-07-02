/**
 * Normalized session-trace model shared by every adapter and by `src/pricing/**`
 * and `src/receipt/**`. An adapter reads an agent's on-disk session files and maps
 * them onto these shapes so downstream code works the same regardless of which
 * agent produced the session.
 *
 * Trimmed for M1 scope (SPEC-0001, agent team config) and extended by
 * SPEC-0010 for opencode; no receipt/attestation/store concepts; a
 * turn-based (not per-message) session shape, since pricing/attribution/waste
 * detection all reason in terms of one assistant turn's usage + tool calls.
 */

/** The canonical, ordered list of supported agent sources — the single source of truth other modules (e.g. the export schema's `source` enum) derive from. */
export const AGENT_SOURCES = ["claude-code", "codex", "cursor", "gemini", "opencode"] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

export const SOURCE_LABELS: Record<AgentSource, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini CLI",
  opencode: "opencode",
};

/**
 * `cacheCreation` (tokens written to the prompt cache) is tracked separately
 * from `cacheRead` (tokens served from it) because a vendor's price schema
 * (`data/prices/<vendor>.json`) may cite distinct cache-write rates
 * (`input_cache_write_5m`/`_1h`) that are more expensive than a plain input
 * token — folding writes into `input` would understate cost on cache-write-
 * heavy sessions (I2: never under-report spend).
 *
 * `cacheCreation` is the always-present total; `cacheCreation5m`/
 * `cacheCreation1h` are the optional split of that total by ephemeral TTL
 * tier. Claude Code's transcript exposes the split (`cache_creation.
 * ephemeral_5m_input_tokens`/`ephemeral_1h_input_tokens`) in newer sessions
 * but only the flat total in older ones — the split fields are `undefined`,
 * not `0`, whenever the transcript didn't report a tier breakdown, so
 * `src/pricing/resolve.ts`'s `costOf` can tell "zero writes at this tier"
 * apart from "tier unknown" and price the unsplit remainder under its
 * documented 5-minute-tier assumption rather than silently treating unknown
 * as zero. See each adapter's `mapUsage` for the exact per-vendor mapping.
 */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  /** Subset of `cacheCreation` billed at the 5-minute ephemeral TTL, when the transcript splits it out. */
  cacheCreation5m?: number;
  /** Subset of `cacheCreation` billed at the 1-hour ephemeral TTL, when the transcript splits it out. */
  cacheCreation1h?: number;
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
  /**
   * SPEC-0019 R1a — attribution-only. The raw session's working directory and
   * git branch (first seen in the transcript). Used solely to match a session
   * to the current repo/worktree for `aireceipts pr`. Absent in the raw
   * transcript → absent here (a session without `cwd` is never auto-attributed).
   * **Privacy rule:** these NEVER enter export schemas (`--json`/`--csv`),
   * rendered receipts, or telemetry — the strict-schema parity tests assert
   * their absence.
   */
  cwd?: string;
  gitBranch?: string;
  /**
   * SPEC-0019 R1c — child (subagent) index, attribution-only. `isSidechain` is
   * true for a subagent transcript at `<parentSessionId>/subagents/**` (excluded
   * from top-level selection); the remaining fields link a child back to the
   * parent it rolls up into. Same privacy rule as `cwd`/`gitBranch`.
   */
  isSidechain?: boolean;
  parentSessionId?: string;
  agentId?: string;
  parentFilePath?: string;
}

/**
 * SPEC-0017 R1/R2 — a raw compaction event extracted from the transcript before
 * the adapter drops `isMeta`/command-echo records. `turnIndex` is the index of
 * the next assistant turn after the raw compact record (so a compaction between
 * two assistant turns points at the second); a compaction after the final
 * assistant turn is retained with `turnIndex = turns.length` and is
 * thrash-ineligible (no following turns to prove refill). `atMs` is the raw
 * record's own timestamp, absent (not synthesized) when the record carried none.
 * Only the Claude Code adapter populates this — other agents record no
 * compaction signal, so their sessions never carry compactions and never thrash.
 */
export interface Compaction {
  turnIndex: number;
  atMs?: number;
}

export interface Session extends SessionSummary {
  turns: Turn[];
  /** SPEC-0017 — raw compaction events, ordered by `turnIndex`. Absent when the adapter records none. */
  compactions?: Compaction[];
}

export interface ListSessionsOptions {
  /**
   * `false` (default) returns lazy discovery rows built from path metadata and
   * the transcript's first line only. `true` asks an adapter to run its full
   * summary parser; callers that need full totals should normally go through
   * `listFullSessions()` so unchanged files hit the summary cache first.
   */
  full?: boolean;
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
  listSessions(options?: ListSessionsOptions): Promise<SessionSummary[]>;
  /** full session (with turns) by its adapter-local id */
  loadSession(id: string): Promise<Session | null>;
}
