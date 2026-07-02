// R1/R2/R3/R6 weekly aggregation. Pure aggregation over SPEC-0001's existing
// attribution + waste primitives — no new detection. The honesty spine (I2):
// a `$` figure sums only priced sessions; a token figure counts every session;
// the two are never merged, and deltas render per category so a change in
// price *coverage* can never masquerade as a change in *spend*.
import { listSessions, loadSession } from "../parse/load.js";
import type { AgentSource, Session, SessionSummary, TokenUsage } from "../parse/types.js";
import { SOURCE_LABELS } from "../parse/types.js";
import { addUsage, emptyUsage } from "../parse/util.js";
import { attributeByTool } from "../pricing/attribution.js";
import { defaultDataDir } from "../pricing/priceTable.js";
import { deriveProjectBucket } from "./project.js";
import { aggregateWaste, type WasteClassAggregate } from "./waste.js";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const TOP_WASTE = 3;

export interface WindowBounds {
  curStart: number;
  curEnd: number;
  priorStart: number;
  priorEnd: number;
}

/**
 * R1: the current window is a fixed 7-day span. Default anchors its end at
 * `now` (`[now-7d, now)`); `--since D` anchors its *start* at `D`
 * (`[D, D+7d)`). The prior window is always the immediately preceding 7 days
 * (`[curStart-7d, curStart)`). Bounds are half-open: start inclusive, end
 * exclusive.
 */
export function windowBounds(now: number, sinceMs?: number): WindowBounds {
  const curStart = sinceMs ?? now - WEEK_MS;
  const curEnd = curStart + WEEK_MS;
  return { curStart, curEnd, priorStart: curStart - WEEK_MS, priorEnd: curStart };
}

export interface PartitionedWindows {
  current: SessionSummary[];
  prior: SessionSummary[];
}

/**
 * R1: bucket summaries into the current/prior windows by `endedAt`. A session
 * with no `endedAt` is excluded from both windows — never guessed into one.
 */
export function partitionWindows(summaries: SessionSummary[], bounds: WindowBounds): PartitionedWindows {
  const current: SessionSummary[] = [];
  const prior: SessionSummary[] = [];
  for (const s of summaries) {
    if (s.endedAt === undefined) {
      continue;
    }
    if (s.endedAt >= bounds.curStart && s.endedAt < bounds.curEnd) {
      current.push(s);
    } else if (s.endedAt >= bounds.priorStart && s.endedAt < bounds.priorEnd) {
      prior.push(s);
    }
  }
  return { current, prior };
}

export interface AgentSplit {
  source: AgentSource;
  label: string;
  /** Priced-subset `$` for this agent; `null` when no session in the bucket priced (I2). */
  usd: number | null;
  tokens: TokenUsage;
  sessionCount: number;
}

export interface ProjectSplit {
  project: string;
  usd: number | null;
  tokens: TokenUsage;
  sessionCount: number;
}

export interface WindowAggregate {
  sessionCount: number;
  pricedSessionCount: number;
  /** Sessions whose `$` could not be computed (no priced turn / unpriceable) — the count excluded from the `$` total. */
  excludedSessionCount: number;
  /** Sum of priced sessions' totals; `null` when zero sessions priced (never rendered as `$0` against unpriced work). */
  pricedUsd: number | null;
  /** Sum over ALL sessions in the window (present even for unpriceable sources). */
  tokenTotal: TokenUsage;
  byAgent: AgentSplit[];
  /** Populated only when `--by-project`; `null` otherwise (R4 opt-in). */
  byProject: ProjectSplit[] | null;
  waste: WasteClassAggregate[];
}

interface SplitAcc {
  usd: number;
  priced: boolean;
  tokens: TokenUsage;
  sessionCount: number;
}

function accOf(map: Map<string, SplitAcc>, key: string): SplitAcc {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }
  const fresh: SplitAcc = { usd: 0, priced: false, tokens: emptyUsage(), sessionCount: 0 };
  map.set(key, fresh);
  return fresh;
}

function addToSplit(acc: SplitAcc, usd: number | null, tokens: TokenUsage): void {
  acc.tokens = addUsage(acc.tokens, tokens);
  acc.sessionCount += 1;
  if (usd !== null) {
    acc.usd += usd;
    acc.priced = true;
  }
}

/** Order splits desc by priced `$` (priced buckets first), then desc tokens, then name — deterministic. */
function orderSplits<T extends { usd: number | null; tokens: TokenUsage }>(rows: T[], name: (r: T) => string): T[] {
  return [...rows].sort((a, b) => {
    if (a.usd !== null && b.usd !== null) {
      return b.usd - a.usd || b.tokens.total - a.tokens.total || name(a).localeCompare(name(b));
    }
    if (a.usd !== null) {
      return -1;
    }
    if (b.usd !== null) {
      return 1;
    }
    return b.tokens.total - a.tokens.total || name(a).localeCompare(name(b));
  });
}

/**
 * R2/R3: aggregate one window's already-loaded sessions. `$` sums priced
 * sessions only; tokens count every session; the per-agent (and opt-in
 * per-project) splits carry the same priced-subset `$` + all-session token
 * discipline, so each split sums to its window total by construction.
 */
export async function aggregateWindow(
  sessions: Session[],
  byProject: boolean,
  dataDir: string = defaultDataDir(),
): Promise<WindowAggregate> {
  const agents = new Map<string, SplitAcc>();
  const projects = new Map<string, SplitAcc>();
  let pricedUsd = 0;
  let anyPriced = false;
  let pricedSessionCount = 0;
  let tokenTotal = emptyUsage();

  for (const session of sessions) {
    const attr = await attributeByTool(session, dataDir);
    const sessionTokens = session.totals.tokens;
    const usd = attr.totalUsd;

    tokenTotal = addUsage(tokenTotal, sessionTokens);
    if (usd !== null) {
      pricedUsd += usd;
      anyPriced = true;
      pricedSessionCount += 1;
    }

    addToSplit(accOf(agents, session.source), usd, sessionTokens);
    if (byProject) {
      addToSplit(accOf(projects, deriveProjectBucket(session.filePath)), usd, sessionTokens);
    }
  }

  const byAgent = orderSplits(
    [...agents.entries()].map(([source, acc]): AgentSplit => ({
      source: source as AgentSource,
      label: SOURCE_LABELS[source as AgentSource],
      usd: acc.priced ? acc.usd : null,
      tokens: acc.tokens,
      sessionCount: acc.sessionCount,
    })),
    (r) => r.source,
  );

  const byProjectRows = byProject
    ? orderSplits(
        [...projects.entries()].map(([project, acc]): ProjectSplit => ({
          project,
          usd: acc.priced ? acc.usd : null,
          tokens: acc.tokens,
          sessionCount: acc.sessionCount,
        })),
        (r) => r.project,
      )
    : null;

  const waste = await aggregateWaste(sessions, dataDir);

  return {
    sessionCount: sessions.length,
    pricedSessionCount,
    excludedSessionCount: sessions.length - pricedSessionCount,
    pricedUsd: anyPriced ? pricedUsd : null,
    tokenTotal,
    byAgent,
    byProject: byProjectRows,
    waste,
  };
}

export interface WeekDelta {
  /** False when the prior window has zero sessions → renders "no prior data", never a fabricated 0% (R6). */
  hasPrior: boolean;
  /**
   * Priced-subset `$` delta, `null` when either window lacks a priced total —
   * a coverage difference is surfaced via `currentExcluded`/`priorExcluded`
   * instead of being smuggled into a spend number (R6, S2).
   */
  pricedUsdDelta: number | null;
  /** All-session token delta — always defined (tokens exist for every session). */
  tokenDelta: number;
  currentExcluded: number;
  priorExcluded: number;
}

/** R6: deltas per category, never blended. A `$` delta only when both windows priced; a token delta always; excluded counts for both windows so coverage change reads separately from spend change. */
export function computeDelta(current: WindowAggregate, prior: WindowAggregate): WeekDelta {
  const bothPriced = current.pricedUsd !== null && prior.pricedUsd !== null;
  return {
    hasPrior: prior.sessionCount > 0,
    pricedUsdDelta: bothPriced ? (current.pricedUsd as number) - (prior.pricedUsd as number) : null,
    tokenDelta: current.tokenTotal.total - prior.tokenTotal.total,
    currentExcluded: current.excludedSessionCount,
    priorExcluded: prior.excludedSessionCount,
  };
}

export interface WeekDigest {
  windowStartMs: number;
  windowEndMs: number;
  priorStartMs: number;
  priorEndMs: number;
  /** True when `--since` overrode the trailing-7-days default (affects the header wording). */
  sinceOverride: boolean;
  byProject: boolean;
  current: WindowAggregate;
  prior: WindowAggregate;
  delta: WeekDelta;
  /** R5: current window's waste classes, top 3 by cost. Fewer than 3 fired → only what fired. */
  topWaste: WasteClassAggregate[];
}

export interface WeekOptions {
  /** Injectable clock (epoch ms) for a frozen-clock digest; defaults to `Date.now()`. */
  now?: number;
  /** `--since` anchor (epoch ms) for the current window's start; omitted → trailing 7 days. */
  sinceMs?: number;
  byProject?: boolean;
  dataDir?: string;
}

async function loadAll(summaries: SessionSummary[]): Promise<Session[]> {
  const loaded = await Promise.all(summaries.map((s) => loadSession(s)));
  return loaded.filter((s): s is Session => s !== null);
}

/**
 * Pure digest assembly over already-loaded window sessions — the deterministic
 * core `buildWeekDigest` wraps once the disk work is done. Kept separate so it
 * can be exercised end-to-end with synthetic sessions (no disk, frozen clock).
 */
export async function assembleWeekDigest(
  bounds: WindowBounds,
  currentSessions: Session[],
  priorSessions: Session[],
  opts: { sinceOverride: boolean; byProject: boolean; dataDir?: string },
): Promise<WeekDigest> {
  const dataDir = opts.dataDir ?? defaultDataDir();
  const [current, prior] = await Promise.all([
    aggregateWindow(currentSessions, opts.byProject, dataDir),
    aggregateWindow(priorSessions, opts.byProject, dataDir),
  ]);
  return {
    windowStartMs: bounds.curStart,
    windowEndMs: bounds.curEnd,
    priorStartMs: bounds.priorStart,
    priorEndMs: bounds.priorEnd,
    sinceOverride: opts.sinceOverride,
    byProject: opts.byProject,
    current,
    prior,
    delta: computeDelta(current, prior),
    topWaste: current.waste.slice(0, TOP_WASTE),
  };
}

/** Disk-facing orchestrator: list → window-partition by `endedAt` → load → aggregate each window → deltas. */
export async function buildWeekDigest(opts: WeekOptions = {}): Promise<WeekDigest> {
  const now = opts.now ?? Date.now();
  const byProject = opts.byProject ?? false;
  const dataDir = opts.dataDir ?? defaultDataDir();
  const bounds = windowBounds(now, opts.sinceMs);

  const summaries = await listSessions();
  const partitioned = partitionWindows(summaries, bounds);
  const [curSessions, priSessions] = await Promise.all([loadAll(partitioned.current), loadAll(partitioned.prior)]);

  return assembleWeekDigest(bounds, curSessions, priSessions, {
    sinceOverride: opts.sinceMs !== undefined,
    byProject,
    dataDir,
  });
}
