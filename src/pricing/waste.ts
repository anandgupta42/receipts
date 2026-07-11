import { posix as posixPath } from "node:path";
import type { Compaction, Session, TokenUsage, ToolCallStatus, Turn } from "../parse/types.js";
import { addUsage, emptyUsage, scaleUsage, withTotal } from "../parse/util.js";
import { defaultDataDir } from "./priceTable.js";
import {
  cheapestCurrentRow,
  costOf,
  costTurnAtRow,
  isoDateOf,
  isPriceableUsage,
  priceSessionTurn,
  pricingUnitsForTurn,
  resolvePrice,
  vendorForSource,
  vendorForTurn,
} from "./resolve.js";

/** Deterministically stringify `value` with object keys sorted, so structurally-identical tool inputs compare equal regardless of key order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",");
  return `{${body}}`;
}

/** `stableStringify` never throws for the caller — a non-serializable input (e.g. a circular reference) degrades to `String(input)` rather than crashing (I1). */
function normalizedInput(input: unknown): string {
  try {
    return stableStringify(input);
  } catch {
    return String(input);
  }
}

const STUCK_LOOP_MIN_RUN = 3;

export interface StuckLoopFinding {
  tool: string;
  runLength: number;
  /** `null` when any call in the run is unpriced — a partial sum would imply a completeness the run doesn't have (I2). */
  usd: number | null;
  tokens: TokenUsage;
  /** `null` when the transcript is missing a `startedAt`/`endedAt` for either end of the run. */
  wallClockMs: number | null;
  /** SPEC-0017 R6 — distinct assistant-turn indices the run's calls came from, for cross-class overlap detection. */
  turnIndices: number[];
}

interface FlatCall {
  tool: string;
  normalizedInput: string;
  /** SPEC-0068 — raw call input (for read `file_path` / shell `command` extraction). */
  input?: unknown;
  /** SPEC-0068 — a real shell execution (may mutate files). */
  shell?: boolean;
  /** SPEC-0068 — a failed read is a retry, not a re-read. */
  status?: ToolCallStatus;
  usd: number | null;
  tokens: TokenUsage;
  turnIndex: number;
  startedAt?: number;
  endedAt?: number;
}

async function flattenCalls(session: Session, dataDir: string): Promise<FlatCall[]> {
  const out: FlatCall[] = [];
  for (const turn of session.turns) {
    if (turn.toolCalls.length === 0) {
      continue;
    }
    const priced = await priceSessionTurn(session, turn, dataDir);
    const completeUsd = priced && priced.unpricedUsage.total === 0 ? priced.usd : null;
    const share = 1 / turn.toolCalls.length;
    const tokenShare: TokenUsage = turn.usage ? scaleUsage(turn.usage, share) : emptyUsage();
    for (const call of turn.toolCalls) {
      out.push({
        tool: call.name,
        normalizedInput: normalizedInput(call.input),
        input: call.input,
        shell: call.shell,
        status: call.status,
        usd: completeUsd !== null ? completeUsd * share : null,
        tokens: tokenShare,
        turnIndex: turn.index,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
      });
    }
  }
  return out;
}

/**
 * R4a: runs of >= 3 *consecutive* tool calls with identical (tool name,
 * normalized input) — a classic "agent stuck retrying the same call"
 * signature. Loop *structure* is detected even for an `unpriceable` session
 * (Cursor has real tool calls, just no usage) — only the dollar figure goes
 * `null` in that case, never the finding itself.
 */
export async function detectStuckLoops(session: Session, dataDir: string = defaultDataDir()): Promise<StuckLoopFinding[]> {
  const calls = await flattenCalls(session, dataDir);
  const findings: StuckLoopFinding[] = [];

  let i = 0;
  while (i < calls.length) {
    let j = i + 1;
    while (j < calls.length && calls[j].tool === calls[i].tool && calls[j].normalizedInput === calls[i].normalizedInput) {
      j++;
    }
    const runLength = j - i;
    if (runLength >= STUCK_LOOP_MIN_RUN) {
      const run = calls.slice(i, j);
      const anyUnpriced = run.some((c) => c.usd === null);
      const tokens = run.reduce((sum, c) => addUsage(sum, c.tokens), emptyUsage());
      const first = run[0];
      const last = run[run.length - 1];
      const wallClockMs = first.startedAt !== undefined && last.endedAt !== undefined ? last.endedAt - first.startedAt : null;
      findings.push({
        tool: run[0].tool,
        runLength,
        usd: anyUnpriced ? null : run.reduce((sum, c) => sum + (c.usd as number), 0),
        tokens,
        wallClockMs,
        turnIndices: [...new Set(run.map((c) => c.turnIndex))].sort((a, b) => a - b),
      });
    }
    i = j;
  }

  return findings;
}

// --- SPEC-0068 same-file re-reads (a LOW-confidence neutral diagnostic) ---------

const READ_TOOL_NAMES = new Set(["Read"]);
const REREAD_EDIT_TOOL_NAMES = new Set(["Edit", "Write", "NotebookEdit"]);
/**
 * Whole-tree shell mutators that can change files WITHOUT naming a basename the
 * substring check would catch. Deliberately narrow: a path-specific `git checkout
 * README.md` is NOT whole-tree (the substring check suppresses only that file);
 * only `.`-targeted / `--hard` / stash / apply / whole-tree formatters qualify.
 */
const WHOLE_TREE_MUTATOR = /\bgit\s+reset\s+--hard\b|\bgit\s+stash\b|\bgit\s+apply\b|\bgit\s+(?:checkout|restore)\s+(?:--\s+)?\.(?:\s|$)|\bprettier\b[^|]*--write|\beslint\b[^|]*--fix|\bfind\b[^|]*-exec/u;

/** Normalize a read/edit path (`file_path`, or `NotebookEdit`'s `notebook_path`): resolve `.`/`..`, collapse separators, strip a trailing slash. Absolute vs relative and different dirs stay distinct — `src/a.ts` !== `test/a.ts` (SPEC-0068 R1). */
function normReadPath(input: unknown): string | undefined {
  if (input && typeof input === "object") {
    const o = input as { file_path?: unknown; notebook_path?: unknown };
    const raw = typeof o.file_path === "string" ? o.file_path : typeof o.notebook_path === "string" ? o.notebook_path : undefined;
    if (raw && raw.length > 0) {
      return posixPath.normalize(raw).replace(/(?!^)\/+$/u, "");
    }
  }
  return undefined;
}

function shellCommandOf(input: unknown): string {
  if (input && typeof input === "object" && "command" in input) {
    const c = (input as { command?: unknown }).command;
    return typeof c === "string" ? c : "";
  }
  return "";
}

export interface SameFileReReadsFinding {
  /** No-recorded-cause re-reads (2nd..Nth reads of a path with no edit/compaction/shell-touch between). */
  count: number;
  /** `null` when any counted re-read is unpriced (I2). */
  usd: number | null;
  tokens: TokenUsage;
  turnIndices: number[];
  /** Always low — the transcript cannot prove the re-read was unnecessary (SPEC-0068 R4). */
  confidence: "low";
}

/**
 * SPEC-0068 R1-R3 — same-FILE re-reads (same normalized path, any range) with no
 * RECORDED edit to that path, compaction, or shell command touching it between the
 * reads. A neutral diagnostic FACT, never a waste verdict (R4) and never a savings
 * claim. `usd` is `null` if any counted re-read is unpriced (I2). Fires only where a
 * `Read` tool with a `file_path` exists (Claude Code) — silent elsewhere (I6).
 */
export async function detectSameFileReReads(session: Session, dataDir: string = defaultDataDir()): Promise<SameFileReReadsFinding | null> {
  const flat = await flattenCalls(session, dataDir);
  const compactionTurns = (session.compactions ?? []).map((c) => c.turnIndex);

  const lastRead = new Map<string, { ord: number; turn: number }>();
  const lastEditOrd = new Map<string, number>();
  // Shell calls in order — a re-read is "shell-touched" if a later-than-prior-read
  // shell command is whole-tree OR mentions the file's basename (substring, so it
  // catches multi-dot/no-extension/dotfile names the regex would miss — Codex #1).
  const shellCalls: { ord: number; cmd: string; wholeTree: boolean }[] = [];

  let count = 0;
  let tokens = emptyUsage();
  let usd: number | null = 0;
  const turnIndices = new Set<number>();

  flat.forEach((f, ord) => {
    if (REREAD_EDIT_TOOL_NAMES.has(f.tool)) {
      const p = normReadPath(f.input);
      if (p) {
        lastEditOrd.set(p, ord);
      }
      return;
    }
    if (f.shell === true || f.tool === "Bash") {
      const cmd = shellCommandOf(f.input);
      shellCalls.push({ ord, cmd, wholeTree: WHOLE_TREE_MUTATOR.test(cmd) });
      return;
    }
    if (!READ_TOOL_NAMES.has(f.tool) || f.status === "error") {
      return; // non-read, or a failed read (a retry, not a re-read)
    }
    const p = normReadPath(f.input);
    if (!p) {
      return;
    }
    const prev = lastRead.get(p);
    if (prev === undefined) {
      lastRead.set(p, { ord, turn: f.turnIndex });
      return;
    }
    const editBetween = (lastEditOrd.get(p) ?? -1) > prev.ord;
    const base = posixPath.basename(p);
    const bashBetween = shellCalls.some((s) => s.ord > prev.ord && (s.wholeTree || s.cmd.includes(base)));
    const compactionBetween = compactionTurns.some((t) => t > prev.turn && t <= f.turnIndex);
    if (!editBetween && !bashBetween && !compactionBetween) {
      count += 1;
      tokens = addUsage(tokens, f.tokens);
      if (f.usd === null) {
        usd = null;
      } else if (usd !== null) {
        usd += f.usd;
      }
      turnIndices.add(f.turnIndex);
    }
    lastRead.set(p, { ord, turn: f.turnIndex });
  });

  if (count === 0) {
    return null;
  }
  return { count, usd, tokens, turnIndices: [...turnIndices].sort((a, b) => a - b), confidence: "low" };
}

const TRIVIAL_SPAN_MAX_OUTPUT_TOKENS = 120;

export interface TrivialSpansFinding {
  eligibleTurnCount: number;
  tokens: TokenUsage;
  usd: number;
  cheaperModel: string;
  /** SPEC-0017 R6 — the eligible tool-free turn indices, for cross-class overlap detection. */
  turnIndices: number[];
}

/**
 * R4b: tool-free assistant turns with a short reply (<= 120 output tokens)
 * whose model has a cheaper current row at the same vendor. Re-priced at
 * the same token volume for the vendor's cheapest current row and rendered
 * as `≈` by the receipt (surface role) — this is arithmetic on real tokens,
 * never a claim that the cheaper model would have produced the same reply.
 */
export async function detectTrivialSpans(session: Session, dataDir: string = defaultDataDir()): Promise<TrivialSpansFinding | null> {
  if (session.unpriceable) {
    return null;
  }
  const sourceVendor = vendorForSource(session.source);
  if (!sourceVendor) {
    return null;
  }
  const cheapest = await cheapestCurrentRow(sourceVendor, dataDir);
  if (!cheapest) {
    return null;
  }

  let eligibleTurnCount = 0;
  let tokens = emptyUsage();
  let usd = 0;
  const turnIndices: number[] = [];

  for (const turn of session.turns) {
    if (turn.toolCalls.length > 0) {
      continue;
    }
    const outputTokens = turn.outputTokens ?? turn.usage?.output;
    if (outputTokens === undefined || outputTokens > TRIVIAL_SPAN_MAX_OUTPUT_TOKENS) {
      continue;
    }
    if (!turn.usage) {
      continue;
    }
    if (!isPriceableUsage(turn.usage)) {
      continue;
    }
    const units = pricingUnitsForTurn(turn);
    if (!units) {
      continue;
    }
    let identitiesEligible = true;
    for (const unit of units) {
      const model = unit.model;
      const dateISO = isoDateOf(unit.timestamp);
      const vendor = vendorForTurn(session.source, model, unit.pricingProvider);
      if (!model || !dateISO || vendor !== sourceVendor) {
        identitiesEligible = false;
        break;
      }
      const row = await resolvePrice(vendor, model, dateISO, dataDir);
      if (!row || !(cheapest.row.input < row.input)) {
        identitiesEligible = false;
        break;
      }
    }
    if (!identitiesEligible) {
      continue;
    }
    eligibleTurnCount += 1;
    tokens = addUsage(tokens, turn.usage);
    const repriced = costTurnAtRow(turn, cheapest.row);
    if (repriced === null) {
      return null;
    }
    usd += repriced;
    turnIndices.push(turn.index);
  }

  if (eligibleTurnCount === 0) {
    return null;
  }

  return { eligibleTurnCount, tokens, usd, cheaperModel: cheapest.model, turnIndices };
}

// SPEC-0017 R3/R4 — provisional, evidence-bound constants (not user knobs). See
// the threshold-justification table in the spec's implementation PR.
/** Look-ahead window (assistant turns) over which post-compaction refill is measured. */
export const CONTEXT_THRASH_K = 5;
/** Post-compaction prompt-side peak must reach this fraction of the pre-compaction peak to count as refill. */
export const CONTEXT_THRASH_REFILL_RATIO = 0.8;
/** Max successive `turnIndex` gap (assistant turns) between two refill-positive compactions in one window. */
export const CONTEXT_THRASH_MAX_GAP = 25;

export interface ContextThrashFinding {
  /** Refill-positive compactions clustered in this window (always ≥ 2). */
  compactionCount: number;
  /** Assistant-turn span from the window's first to last compaction. */
  turnSpan: number;
  /** The unioned, contributing (usage-bearing) post-compaction turn indices — the cost basis. */
  turnIndices: number[];
  /** Prompt-only tokens re-spent rebuilding context (output stripped), summed over `turnIndices`. */
  tokens: TokenUsage;
  /** `null` unless every contributing turn resolves a cited price row — no partial-dollar line (I2). */
  usd: number | null;
}

/** R3 — prompt-side load of a turn: `input + cacheRead + cacheCreation`. A turn with no usage contributes 0. */
function promptSide(turn: Turn): number {
  const u = turn.usage;
  return u ? u.input + u.cacheRead + u.cacheCreation : 0;
}

/** R5 — slice a turn's usage to its prompt-only portion (`output = 0`), preserving cache tiers so `costOf` prices each at its cited rate. */
function promptOnlyUsage(usage: TokenUsage): TokenUsage {
  return withTotal({
    input: usage.input,
    output: 0,
    cacheRead: usage.cacheRead,
    cacheCreation: usage.cacheCreation,
    cacheCreation5m: usage.cacheCreation5m,
    cacheCreation1h: usage.cacheCreation1h,
    total: 0,
  });
}

/**
 * R3/R5 — context-thrash: compaction churn where prompt-side context refills near
 * its pre-compaction peak, i.e. the session is paying to *rebuild* context rather
 * than doing new work. A compaction is refill-positive when the pre-compaction
 * prompt-side peak is positive and some turn in the next `K` reaches
 * `REFILL_RATIO` of it (R3 — proximity alone never fires). A thrash window is a
 * contiguous run of ≥ 2 refill-positive compactions whose successive `turnIndex`
 * gaps are all `≤ T`. Its cost is the union of the `K`-turn post-compaction slices
 * after each **non-first** compaction (the repeated rebuilds), each turn sliced to
 * prompt-only tokens and priced by the existing cache-tier logic; `usd` is `null`
 * unless every contributing turn resolves a cited row (R5, no partial dollar).
 * Returns one finding per fired window (windows never share turns — a gap `> T`
 * separates them, wider than any `K`-turn slice).
 */
export async function detectContextThrash(session: Session, dataDir: string = defaultDataDir()): Promise<ContextThrashFinding[]> {
  const compactions = session.compactions ?? [];
  if (compactions.length < 2) {
    return [];
  }
  const turns = session.turns;
  const n = turns.length;

  const isRefillPositive = (c: Compaction): boolean => {
    // R2 — a compaction after the final assistant turn has no following turns to prove refill.
    if (c.turnIndex >= n) {
      return false;
    }
    let prePeak = 0;
    for (let i = 0; i < c.turnIndex; i++) {
      prePeak = Math.max(prePeak, promptSide(turns[i]));
    }
    if (prePeak <= 0) {
      return false;
    }
    let postPeak = 0;
    for (let i = c.turnIndex; i < Math.min(n, c.turnIndex + CONTEXT_THRASH_K); i++) {
      postPeak = Math.max(postPeak, promptSide(turns[i]));
    }
    return postPeak >= CONTEXT_THRASH_REFILL_RATIO * prePeak;
  };

  const positives = [...compactions].sort((a, b) => a.turnIndex - b.turnIndex).filter(isRefillPositive);

  // R3 — cluster contiguous refill-positive compactions with successive gap ≤ T.
  const windows: Compaction[][] = [];
  let current: Compaction[] = [];
  for (const c of positives) {
    if (current.length === 0 || c.turnIndex - current[current.length - 1].turnIndex <= CONTEXT_THRASH_MAX_GAP) {
      current.push(c);
    } else {
      if (current.length >= 2) {
        windows.push(current);
      }
      current = [c];
    }
  }
  if (current.length >= 2) {
    windows.push(current);
  }

  const findings: ContextThrashFinding[] = [];
  for (const window of windows) {
    // R5 — union the K-turn slices after each NON-FIRST compaction, so overlapping
    // slices never double-count; the first compaction's rebuild is expected, the
    // repeats are the waste.
    const unioned = new Set<number>();
    for (let k = 1; k < window.length; k++) {
      const start = window[k].turnIndex;
      for (let i = start; i < Math.min(n, start + CONTEXT_THRASH_K); i++) {
        unioned.add(i);
      }
    }

    let tokens = emptyUsage();
    let usd: number | null = 0;
    const contributing: number[] = [];
    for (const i of [...unioned].sort((a, b) => a - b)) {
      const turn = turns[i];
      if (!turn.usage) {
        continue;
      }
      contributing.push(i);
      const sliced = promptOnlyUsage(turn.usage);
      tokens = addUsage(tokens, sliced);
      const slicedTurn: Turn = {
        ...turn,
        usage: sliced,
        pricingUnits: turn.pricingUnits?.map((unit) => ({ ...unit, usage: promptOnlyUsage(unit.usage) })),
      };
      const priced = await priceSessionTurn(session, slicedTurn, dataDir);
      if (priced === null || priced.unpricedUsage.total > 0) {
        usd = null;
      } else if (usd !== null) {
        usd += priced.usd;
      }
    }

    findings.push({
      compactionCount: window.length,
      turnSpan: window[window.length - 1].turnIndex - window[0].turnIndex,
      turnIndices: contributing,
      tokens,
      usd,
    });
  }
  return findings;
}

export interface PriceDeltaFootnote {
  cheaperModel: string;
  usd: number;
  /** Explicit name for the observed session's Standard-API floor. */
  baselineUsd?: number;
  /** @deprecated Compatibility alias for `baselineUsd`; never an invoice amount. */
  actualUsd: number;
}

/**
 * R5's price-delta arithmetic footnote: the session's already-priced total
 * token volume (`totalTokens`/the observed baseline floor, computed upstream by
 * `attributeByTool`) re-priced at the vendor's cheapest current row. A pure
 * primitive — it takes the totals as parameters rather than recomputing
 * them, so the receipt renderer (surface role) wires it to whatever total
 * it already displays instead of risking two independently-computed
 * figures drifting apart. Labeled "arithmetic, not a prediction" by the
 * renderer, never a whole-session cheaper-model claim (non-goals).
 */
export async function priceDeltaFootnote(
  session: Session,
  totalTokens: TokenUsage,
  actualUsd: number,
  dataDir: string = defaultDataDir(),
): Promise<PriceDeltaFootnote | null> {
  if (session.unpriceable || !isPriceableUsage(totalTokens)) {
    return null;
  }
  const vendor = vendorForSource(session.source);
  if (!vendor) {
    return null;
  }
  for (const turn of session.turns) {
    if (turn.usage && turn.usage.total > 0) {
      const units = pricingUnitsForTurn(turn);
      if (!units) {
        return null;
      }
      for (const unit of units) {
        const model = unit.model;
        const provider = unit.pricingProvider;
        if (!model || isoDateOf(unit.timestamp) === undefined) {
          return null;
        }
        if (vendorForTurn(session.source, model, provider) !== vendor) {
          return null;
        }
      }
    }
  }
  const cheapest = await cheapestCurrentRow(vendor, dataDir);
  if (!cheapest) {
    return null;
  }
  let alternativeUsd = 0;
  let usageTurnCount = 0;
  for (const turn of session.turns) {
    if (!turn.usage || turn.usage.total === 0) {
      continue;
    }
    usageTurnCount++;
    const repriced = costTurnAtRow(turn, cheapest.row);
    if (repriced === null) {
      return null;
    }
    alternativeUsd += repriced;
  }
  // Compatibility for callers that provide only a normalized total: grouping
  // is irrelevant for a linear row, but a tiered row cannot be selected safely
  // without request boundaries.
  if (usageTurnCount === 0) {
    if ((cheapest.row.context_tiers?.length ?? 0) > 0) {
      return null;
    }
    alternativeUsd = costOf(totalTokens, cheapest.row);
  }
  return {
    cheaperModel: cheapest.model,
    usd: alternativeUsd,
    baselineUsd: actualUsd,
    actualUsd,
  };
}
