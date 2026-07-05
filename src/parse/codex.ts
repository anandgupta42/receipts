import type { AgentSource, Compaction, ListSessionsOptions, Session, SessionAdapter, SessionSummary, TokenUsage, ToolCall, Turn } from "./types.js";
import { codexFidelity } from "./fidelity/codex.js";
import { lazyCodexSummary, nodeDiscoveryFs, type DiscoveryFs } from "./discovery.js";
import {
  addUsage,
  emptyUsage,
  expandHome,
  listFiles,
  mapWithConcurrency,
  parseTimestamp,
  pathExists,
  readJsonl,
  truncate,
  withTotal, sanitizeText } from "./util.js";

/** Raw usage shape from a Codex `rollout-*.jsonl` `token_count` event. */
interface CodexUsage {
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
  reasoning_output_tokens?: number;
}

/**
 * Map Codex's raw usage onto our 4-component `TokenUsage`. Unlike the private
 * reference implementation, we do NOT subtract `reasoning_output_tokens` from
 * `output` — our `TokenUsage` has no separate reasoning bucket to absorb those
 * tokens into, so subtracting them would silently drop billed spend from the
 * total (I2: never under-report). Reasoning tokens stay folded into `output`.
 * `cacheCreation` is always 0 here: OpenAI's usage payload has no cache-write
 * counterpart to `cached_input_tokens` — prompt caching is automatic and its
 * pricing only ever discounts cached reads (per team-lead: "OpenAI publishes
 * cached-read only"), so `openai.json` price rows carry no
 * `input_cache_write_*` fields for `costOf` to price against.
 */
function mapUsage(usage: CodexUsage | undefined) {
  if (!usage) {
    return undefined;
  }
  const input = Math.max(0, (usage.input_tokens ?? 0) - (usage.cached_input_tokens ?? 0));
  return withTotal({
    input,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cached_input_tokens ?? 0,
    cacheCreation: 0,
    total: 0,
  });
}

/**
 * SPEC-0040 R1 — max spacing for a `compacted` record and its
 * `context_compacted` marker to merge as ONE event. Real pairs sit ~2-3ms
 * apart (sampled 2026-07-04); distinct compactions in the same rollout are
 * minutes apart (96 events over ~38h). 5s cleanly separates the two regimes
 * without a mushy heuristic; events missing a timestamp fall back to
 * same-`turnIndex` pairing alone.
 */
const COMPACTION_PAIR_WINDOW_MS = 5_000;

/** Codex nests the interesting payload under one of a few keys depending on event type. */
function unwrap(top: Record<string, unknown>): Record<string, unknown> {
  const candidates = ["payload", "item", "response"];
  for (const key of candidates) {
    const v = top[key];
    if (v && typeof v === "object") {
      return v as Record<string, unknown>;
    }
  }
  return top;
}

function extractText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return typeof part === "string" ? part : undefined;
      })
      .filter((p): p is string => typeof p === "string");
    return parts.length > 0 ? parts.join("") : undefined;
  }
  return undefined;
}

function parseMaybeJson(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return raw;
  }
  if (!/^\s*[[{]/.test(raw)) {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * One generic `ToolCall` per invocation, including `apply_patch` (a
 * `custom_tool_call`). We deliberately don't decompose `apply_patch` into a
 * `ToolCall` per touched file the way the private reference does — the raw
 * patch text is preserved as `input`/`output` and that's enough for R4a/R4b,
 * which reason about call count and duration, not per-file diffs.
 */
async function parseTranscript(filePath: string, withTurns: boolean) {
  let model: string | undefined;
  let userPrompt: string | undefined;
  let firstUserText: string | undefined;
  let startedAt: number | undefined;
  let endedAt: number | undefined;
  let cwd: string | undefined;
  let cumulativeUsage: TokenUsage | undefined;
  let perTurnUsage = emptyUsage();
  let sawCumulative = false;
  let toolCallCount = 0;
  const turns: Turn[] = [];
  const toolCallById = new Map<string, ToolCall>();
  let current: Turn | null = null;

  // SPEC-0040 R1/R2 — one entry per DISTINCT compaction event. A `compacted`
  // record and its `context_compacted` marker describe the same event and
  // merge when they are OPPOSITE forms at the same next-turn position: real
  // streams (sampled 2026-07-04) emit the marker a few records and ~2-3ms
  // after its `compacted` record, so neither timestamp equality nor strict
  // adjacency holds — but the pair always shares its `turnIndex` and forms
  // alternate per event. Distinct same-form events sharing a next-turn index
  // are ALL retained — collapsing them would undercount thrash. Extraction
  // never touches turn segmentation.
  interface CompactionEvent {
    turnIndex: number;
    atMs?: number;
    form: "compacted" | "context_compacted";
    paired: boolean;
  }
  const compactionEvents: CompactionEvent[] = [];

  function ensureTurn(ts?: number): Turn {
    if (!current) {
      current = { index: turns.length, timestamp: ts, toolCalls: [] };
      turns.push(current);
    }
    return current;
  }

  await readJsonl(filePath, (record) => {
    if (!record || typeof record !== "object") {
      return;
    }
    const top = record as Record<string, unknown>;
    const ts = parseTimestamp(top.timestamp ?? top.created_at ?? top.time);
    if (ts !== undefined) {
      startedAt = startedAt === undefined ? ts : Math.min(startedAt, ts);
      endedAt = endedAt === undefined ? ts : Math.max(endedAt, ts);
    }

    const item = unwrap(top);
    const type = String(item.type ?? top.type ?? "");

    // SPEC-0040 R1/R2 — `turnIndex` is the index the NEXT assistant turn will
    // receive (`turns.length` — an open turn is already in `turns`, so this is
    // `current.index + 1`); after-final compactions land at `turns.length` and
    // are thrash-ineligible (SPEC-0017 R2 semantics).
    if (type === "compacted" || type === "context_compacted") {
      const last = compactionEvents[compactionEvents.length - 1];
      const pairsWithLast =
        last !== undefined &&
        !last.paired &&
        last.form !== type &&
        last.turnIndex === turns.length &&
        (last.atMs === undefined || ts === undefined || Math.abs(ts - last.atMs) <= COMPACTION_PAIR_WINDOW_MS);
      if (pairsWithLast) {
        last.paired = true;
        last.atMs ??= ts;
      } else {
        compactionEvents.push({ turnIndex: turns.length, atMs: ts, form: type, paired: false });
      }
      return;
    }

    if (typeof item.model === "string") {
      model ??= item.model;
    }
    // R1a: first-seen cwd (attribution-only), reported on session_meta/turn_context.
    if (cwd === undefined && typeof item.cwd === "string" && item.cwd) {
      cwd = item.cwd;
    }

    // Cumulative-usage envelopes (Codex ≥0.137): `total_token_usage` is a
    // last-wins snapshot that already sums prior turns; `last_token_usage` is
    // the delta billed to the turn that just completed.
    const info = item.info as Record<string, unknown> | undefined;
    if (info) {
      const total = mapUsage(info.total_token_usage as CodexUsage);
      if (total && total.total > 0) {
        cumulativeUsage = total;
        sawCumulative = true;
        const delta = mapUsage(info.last_token_usage as CodexUsage);
        if (delta && delta.total > 0) {
          const t = ensureTurn(ts);
          t.usage = addUsage(t.usage ?? emptyUsage(), delta);
          t.outputTokens = t.usage.output;
          t.model ??= model;
        }
      }
    }
    if (!sawCumulative) {
      const perMsg = mapUsage((item.usage as CodexUsage) ?? (top.usage as CodexUsage));
      if (perMsg && perMsg.total > 0) {
        perTurnUsage = addUsage(perTurnUsage, perMsg);
        const t = ensureTurn(ts);
        if (!t.usage) {
          t.usage = perMsg;
          t.outputTokens = perMsg.output;
          t.model ??= model;
        }
      }
    }

    if (type === "user_message" && typeof item.message === "string") {
      userPrompt ??= item.message;
      current = null; // a real user message ends the prior turn
      return;
    }

    if (type === "message") {
      const role = item.role;
      if (role === "user") {
        firstUserText ??= extractText(item.content);
        current = null;
        return;
      }
      if (role === "assistant") {
        const t = ensureTurn(ts);
        t.model ??= model;
      }
      return;
    }

    if (type === "function_call" || type === "tool_call" || type === "custom_tool_call") {
      toolCallCount++;
      const callId = String(item.call_id ?? item.id ?? "");
      const name = sanitizeText(String(item.name ?? "tool"));
      const call: ToolCall = {
        name,
        input: parseMaybeJson(item.arguments ?? item.input),
        status: "running",
        startedAt: ts,
        // Deviation from SPEC-0038 R1a's letter, recorded in Validation: codex
        // fixtures carry `exec_command` (not `shell`) as the real shell surface;
        // both are flagged. Launch detection reads invocations, not this flag.
        ...(name === "shell" || name === "exec_command" ? { shell: true } : {}),
      };
      if (callId) {
        toolCallById.set(callId, call);
      }
      ensureTurn(ts).toolCalls.push(call);
      return;
    }

    if (type === "function_call_output" || type === "tool_result" || type === "patch_apply_end") {
      const callId = String(item.call_id ?? item.id ?? "");
      const existing = toolCallById.get(callId);
      if (existing) {
        existing.output = extractText(item.output ?? item.content) ?? existing.output;
        existing.status = item.success === false ? "error" : "ok";
        existing.endedAt = ts;
      }
      return;
    }
  });

  const totalUsage = sawCumulative ? (cumulativeUsage ?? emptyUsage()) : perTurnUsage;

  const totals = {
    tokens: totalUsage,
    durationMs: startedAt !== undefined && endedAt !== undefined ? endedAt - startedAt : undefined,
    turnCount: turns.length,
    toolCallCount,
  };

  const title = userPrompt ?? firstUserText;
  const summary: SessionSummary = {
    id: filePath,
    source: "codex",
    title: title ? truncate(title) : undefined,
    model,
    startedAt,
    endedAt,
    totals,
    filePath,
    cwd,
  };

  // SPEC-0040 — stream order is nondecreasing in `turnIndex`, so no re-sort;
  // `atMs` stays absent (never 0) when the record carried no timestamp.
  const compactions: Compaction[] = compactionEvents.map((e) =>
    e.atMs === undefined ? { turnIndex: e.turnIndex } : { turnIndex: e.turnIndex, atMs: e.atMs },
  );

  return withTurns ? { summary, turns, compactions } : { summary, turns: [] as Turn[], compactions: [] as Compaction[] };
}

const ROOT = "~/.codex/sessions";

export class CodexAdapter implements SessionAdapter {
  readonly id: AgentSource = "codex";
  readonly label = "Codex";
  readonly vendor = "openai";
  readonly fidelity = codexFidelity;

  private readonly root: string;
  private readonly discoveryFs: DiscoveryFs;

  constructor(opts: { root?: string; fs?: DiscoveryFs } = {}) {
    this.root = opts.root ?? expandHome(ROOT);
    this.discoveryFs = opts.fs ?? nodeDiscoveryFs;
  }

  roots(): string[] {
    return [this.root];
  }

  async detect(): Promise<boolean> {
    return pathExists(this.root);
  }

  async listSessions(options: ListSessionsOptions = {}): Promise<SessionSummary[]> {
    const files = await listFiles(this.root, (name) => name.startsWith("rollout-") && name.endsWith(".jsonl"));
    const results = await mapWithConcurrency(files, 16, async (file) => {
      try {
        const stat = await this.discoveryFs.stat(file);
        if (stat.size === 0) {
          return null;
        }
        if (!options.full) {
          const firstLine = await this.discoveryFs.readFirstLine(file);
          return lazyCodexSummary({ filePath: file, source: this.id, stat, firstLine });
        }
        const { summary } = await parseTranscript(file, false);
        return summary;
      } catch {
        return null;
      }
    });
    return results.filter((s): s is SessionSummary => s !== null);
  }

  async loadSession(id: string): Promise<Session | null> {
    try {
      if (!(await pathExists(id))) {
        return null;
      }
      const { summary, turns, compactions } = await parseTranscript(id, true);
      // SPEC-0040 R5 — absent (not `[]`) when the transcript records none.
      return compactions.length > 0 ? { ...summary, turns, compactions } : { ...summary, turns };
    } catch {
      return null;
    }
  }
}
