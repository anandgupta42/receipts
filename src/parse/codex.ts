import type { AgentSource, Compaction, ListSessionsOptions, Session, SessionAdapter, SessionSummary, TokenUsage, ToolCall, Turn } from "./types.js";
import { codexFidelity } from "./fidelity/codex.js";
import { lazyCodexSummary, nodeDiscoveryFs, type DiscoveryFs } from "./discovery.js";
import { normalizePricingProvider } from "./provider.js";
import {
  emptyUsage,
  expandHome,
  listFiles,
  mapWithConcurrency,
  parseTimestamp,
  pathExists,
  readJsonl,
  safeTokenSum,
  truncate,
  withTotal, sanitizeText } from "./util.js";

/** Raw usage shape from a Codex `rollout-*.jsonl` `token_count` event. */
interface CodexUsage {
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface MappedCodexUsage {
  usage?: TokenUsage;
  malformed: boolean;
}

/**
 * Map Codex's raw usage onto our 4-component `TokenUsage`. Unlike the private
 * reference implementation, we do NOT subtract `reasoning_output_tokens` from
 * `output` — our `TokenUsage` has no separate reasoning bucket to absorb those
 * tokens into, so subtracting them would silently drop billed spend from the
 * total (I2: never under-report). Reasoning tokens stay folded into `output`.
 * `cacheCreation` is always 0 here: Codex's persisted usage payload has no
 * cache-write counterpart to `cached_input_tokens`. Some OpenAI models do
 * publish a cache-write price, so receipts explicitly caveat that this
 * unobserved component is excluded from the observable floor.
 */
function mapUsage(raw: unknown): MappedCodexUsage {
  if (raw === undefined || raw === null) {
    return { malformed: false };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { malformed: true };
  }

  const usage = raw as CodexUsage;
  const fields: ReadonlyArray<keyof CodexUsage> = [
    "input_tokens",
    "output_tokens",
    "cached_input_tokens",
    "reasoning_output_tokens",
    "total_tokens",
  ];
  if (fields.some((field) => usage[field] !== undefined && (!Number.isSafeInteger(usage[field]) || (usage[field] as number) < 0))) {
    return { malformed: true };
  }

  const inputTokens = usage.input_tokens ?? 0;
  const cachedInputTokens = usage.cached_input_tokens ?? 0;
  if (cachedInputTokens > inputTokens) {
    return { malformed: true };
  }

  const uncachedInputTokens = inputTokens - cachedInputTokens;
  const outputTokens = usage.output_tokens ?? 0;
  const total = safeTokenSum([uncachedInputTokens, outputTokens, cachedInputTokens]);
  if (total === undefined) {
    return { malformed: true };
  }

  return {
    malformed: false,
    usage: {
      input: uncachedInputTokens,
      output: outputTokens,
      cacheRead: cachedInputTokens,
      cacheCreation: 0,
      total,
    },
  };
}

function sameUsage(a: TokenUsage, b: TokenUsage): boolean {
  return (
    a.input === b.input &&
    a.output === b.output &&
    a.cacheRead === b.cacheRead &&
    a.cacheCreation === b.cacheCreation &&
    a.total === b.total
  );
}

/** Keep the largest coherent usage vector that the transcript independently observed. */
function maxObservedUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return b.total > a.total ? b : a;
}

/** Add coherent Codex usage vectors without ever crossing JS's exact-integer boundary. */
function safeAddCodexUsage(a: TokenUsage, b: TokenUsage): TokenUsage | undefined {
  const input = safeTokenSum([a.input, b.input]);
  const output = safeTokenSum([a.output, b.output]);
  const cacheRead = safeTokenSum([a.cacheRead, b.cacheRead]);
  const cacheCreation = safeTokenSum([a.cacheCreation, b.cacheCreation]);
  if (input === undefined || output === undefined || cacheRead === undefined || cacheCreation === undefined) {
    return undefined;
  }
  const total = safeTokenSum([input, output, cacheRead, cacheCreation]);
  const reportedTotal = safeTokenSum([a.total, b.total]);
  if (total === undefined || reportedTotal === undefined || total !== reportedTotal) {
    return undefined;
  }
  return { input, output, cacheRead, cacheCreation, total };
}

function componentwiseDominates(a: TokenUsage, b: TokenUsage): boolean {
  return (
    a.input >= b.input &&
    a.output >= b.output &&
    a.cacheRead >= b.cacheRead &&
    a.cacheCreation >= b.cacheCreation
  );
}

/** Component-wise envelope subtraction; malformed negative deltas stay
 * visible to fidelity validation instead of entering receipts as negative
 * tokens or dollars. */
function subtractUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return withTotal({
    input: Math.max(0, a.input - b.input),
    output: Math.max(0, a.output - b.output),
    cacheRead: Math.max(0, a.cacheRead - b.cacheRead),
    cacheCreation: Math.max(0, a.cacheCreation - b.cacheCreation),
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
  let currentModel: string | undefined;
  let currentPricingProvider: Turn["pricingProvider"];
  let userPrompt: string | undefined;
  let firstUserText: string | undefined;
  let startedAt: number | undefined;
  let endedAt: number | undefined;
  let cwd: string | undefined;
  let cumulativeUsage: TokenUsage | undefined;
  let cumulativeBaseline: TokenUsage | undefined;
  let observedUsageEnvelope = emptyUsage();
  let perTurnUsage = emptyUsage();
  let sawCumulative = false;
  let sawLegacyUsage = false;
  let requestEvidenceValid = true;
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
    if (currentPricingProvider !== undefined && current.pricingProvider === undefined) {
      current.pricingProvider = currentPricingProvider;
    }
    return current;
  }

  const droppedRecords = await readJsonl(filePath, (record) => {
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

    const providerOwner = Object.prototype.hasOwnProperty.call(item, "model_provider")
      ? item
      : Object.prototype.hasOwnProperty.call(top, "model_provider")
        ? top
        : undefined;
    if (providerOwner) {
      currentPricingProvider = normalizePricingProvider(providerOwner.model_provider);
    }

    if (typeof item.model === "string") {
      currentModel = item.model;
      model ??= currentModel;
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
      const hasTotalUsage = Object.prototype.hasOwnProperty.call(info, "total_token_usage");
      const hasReportedDelta = Object.prototype.hasOwnProperty.call(info, "last_token_usage");
      const mappedTotal = mapUsage(info.total_token_usage);
      const mappedReportedDelta = mapUsage(info.last_token_usage);
      if (mappedTotal.malformed || mappedReportedDelta.malformed) {
        requestEvidenceValid = false;
      }
      const total = mappedTotal.usage;
      const reportedDelta = mappedReportedDelta.usage;
      if (
        hasReportedDelta &&
        (!hasTotalUsage || !total || (total.total === 0 && reportedDelta !== undefined && reportedDelta.total > 0))
      ) {
        // `last_token_usage` alone proves an observable request-shaped lower
        // bound, but not whether repeated records are distinct requests. Keep
        // the largest coherent observation once and disable request pricing.
        requestEvidenceValid = false;
      }
      if (reportedDelta && reportedDelta.total > 0) {
        observedUsageEnvelope = maxObservedUsage(observedUsageEnvelope, reportedDelta);
      }
      if (total && total.total > 0) {
        if (!sawCumulative && sawLegacyUsage) {
          requestEvidenceValid = false;
        }
        sawCumulative = true;
        // Codex's cumulative envelope is allowed to repeat unchanged while
        // retaining the prior turn's non-zero `last_token_usage`. Treating
        // every record as a new turn bills that stale delta twice. A changed
        // cumulative snapshot is the independent evidence that a new local
        // usage event completed.
        const previousCumulative = cumulativeUsage;
        const changed = previousCumulative === undefined || !sameUsage(total, previousCumulative);
        if (previousCumulative === undefined) {
          if (reportedDelta && reportedDelta.total > 0) {
            if (!componentwiseDominates(total, reportedDelta)) {
              requestEvidenceValid = false;
            }
            cumulativeBaseline = subtractUsage(total, reportedDelta);
          } else {
            // A non-zero first total without a non-zero local delta is
            // ambiguous: it may be an inherited baseline, or it may be the
            // root rollout's first request. Never infer which. Fail the whole
            // request stream closed and retain the final cumulative envelope
            // once as unattributed usage.
            requestEvidenceValid = false;
            cumulativeBaseline = emptyUsage();
          }
        }
        observedUsageEnvelope = maxObservedUsage(
          observedUsageEnvelope,
          subtractUsage(total, cumulativeBaseline ?? emptyUsage()),
        );
        cumulativeUsage = total;
        // After the first snapshot, the cumulative vector itself is the
        // authoritative independent accounting. Derive the billed turn from
        // its component delta so a stale/malformed `last_token_usage` cannot
        // emit a knowingly wrong dollar in normal receipts (the fidelity
        // harness is not part of that product path). The first local delta is
        // still needed to identify an inherited parent baseline.
        const delta = previousCumulative === undefined
          ? reportedDelta
          : subtractUsage(total, previousCumulative);
        if (previousCumulative !== undefined && changed) {
          if (!componentwiseDominates(total, previousCumulative)) {
            requestEvidenceValid = false;
          }
          if (!reportedDelta || !delta || reportedDelta.total === 0 || !sameUsage(delta, reportedDelta)) {
            requestEvidenceValid = false;
          }
        }
        if (changed && delta && delta.total > 0) {
          const t = ensureTurn(ts);
          const combinedUsage = safeAddCodexUsage(t.usage ?? emptyUsage(), delta);
          if (!combinedUsage) {
            requestEvidenceValid = false;
          } else {
            t.usage = combinedUsage;
            t.outputTokens = combinedUsage.output;
            t.model ??= currentModel;
            (t.pricingUnits ??= []).push({
              usage: delta,
              timestamp: ts,
              model: currentModel,
              pricingProvider: currentPricingProvider,
            });
          }
        }
      }
    }
    if (!sawCumulative) {
      const mappedPerMsg = mapUsage(item.usage ?? top.usage);
      if (mappedPerMsg.malformed) {
        requestEvidenceValid = false;
      }
      const perMsg = mappedPerMsg.usage;
      if (perMsg && perMsg.total > 0) {
        sawLegacyUsage = true;
        observedUsageEnvelope = maxObservedUsage(observedUsageEnvelope, perMsg);
        const t = ensureTurn(ts);
        const combinedTotalUsage = safeAddCodexUsage(perTurnUsage, perMsg);
        const combinedTurnUsage = safeAddCodexUsage(t.usage ?? emptyUsage(), perMsg);
        if (!combinedTotalUsage || !combinedTurnUsage) {
          requestEvidenceValid = false;
        } else {
          perTurnUsage = combinedTotalUsage;
          t.usage = combinedTurnUsage;
          t.outputTokens = combinedTurnUsage.output;
          t.model ??= currentModel;
          (t.pricingUnits ??= []).push({
            usage: perMsg,
            timestamp: ts,
            model: currentModel,
            pricingProvider: currentPricingProvider,
          });
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
        t.model ??= currentModel;
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

  // Forked/resumed Codex rollouts can inherit a parent-inclusive cumulative
  // baseline. The first local `last_token_usage` identifies exactly how much
  // of the first snapshot belongs to this file. Subtract that fixed baseline
  // from the final envelope so session totals describe the local rollout and
  // remain an independent fidelity oracle for all later deltas.
  const reconciledTotalUsage = sawCumulative
    ? subtractUsage(cumulativeUsage ?? emptyUsage(), cumulativeBaseline ?? emptyUsage())
    : perTurnUsage;
  let summedTurnUsage = emptyUsage();
  let turnSumOverflow = false;
  for (const turn of turns) {
    const combined = safeAddCodexUsage(summedTurnUsage, turn.usage ?? emptyUsage());
    if (!combined) {
      turnSumOverflow = true;
      break;
    }
    summedTurnUsage = combined;
  }
  const usageReconciliationFailed =
    droppedRecords > 0 || turnSumOverflow || !requestEvidenceValid || !sameUsage(summedTurnUsage, reconciledTotalUsage);
  const totalUsage = usageReconciliationFailed
    ? maxObservedUsage(reconciledTotalUsage, observedUsageEnvelope)
    : reconciledTotalUsage;
  if (usageReconciliationFailed) {
    // Without a complete, monotone request envelope sequence, a cumulative
    // delta may combine requests and select the wrong context tier. Preserve
    // the final local envelope as unattributed tokens, but remove every
    // request-level pricing claim.
    for (const turn of turns) {
      delete turn.usage;
      delete turn.outputTokens;
      delete turn.pricingUnits;
    }
  }

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

  return withTurns
    ? {
        summary,
        turns,
        compactions,
        droppedRecords,
        ...(usageReconciliationFailed ? { usageReconciliationFailed: true as const } : {}),
        ...(usageReconciliationFailed && totalUsage.total > 0 ? { unattributedUsage: totalUsage } : {}),
      }
    : { summary, turns: [] as Turn[], compactions: [] as Compaction[], droppedRecords: 0 };
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
      const { summary, turns, compactions, droppedRecords, usageReconciliationFailed, unattributedUsage } = await parseTranscript(id, true);
      // SPEC-0040 R5 — compactions absent (not `[]`) when none; SPEC-0044 B3 —
      // droppedRecords present only when > 0 (absent → clean).
      const dropped = droppedRecords > 0 ? { droppedRecords } : {};
      const reconciliation = usageReconciliationFailed
        ? { usageReconciliationFailed, ...(unattributedUsage ? { unattributedUsage } : {}) }
        : {};
      return compactions.length > 0
        ? { ...summary, turns, compactions, ...dropped, ...reconciliation }
        : { ...summary, turns, ...dropped, ...reconciliation };
    } catch {
      return null;
    }
  }
}
