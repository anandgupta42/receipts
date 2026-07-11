// SPEC-0019 R1c — roll subagent (child) sessions up into the parent's PR
// receipt. A child is included iff its own window overlaps the rendered parent
// slice (their time intervals intersect; an overlapping child is attributed
// whole). A child that fails to parse is listed as
// `(unreadable)` and counted, never silently dropped. Children of a full-session
// fallback are all included. A sliced parent with no observable time window
// cannot safely claim any readable child's usage.
import { discoverChildFiles, parseChildPath } from "../parse/children.js";
import { loadById } from "../parse/load.js";
import type { Session, TokenUsage } from "../parse/types.js";
import { emptyUsage } from "../parse/util.js";
import { buildReceiptModel } from "../receipt/model.js";

export interface SubagentRow {
  /** Display name — the child's title if present, else its agent id. */
  name: string;
  model?: string;
  /** `null` → the child priced to nothing renderable; show tokens instead (I2). */
  usd: number | null;
  tokens: TokenUsage;
  /** Exact child tokens excluded from a partial `usd`; absent unless the child has both priced and unpriced turns. */
  unpricedTokens?: TokenUsage;
  /** The child transcript could not be parsed — usd/tokens are unknown. */
  unreadable: boolean;
  /** SPEC-0044 B3 — malformed records skipped in this child's transcript; `> 0` → its cost is a lower bound. */
  droppedRecords?: number;
  /** Child priced GPT-5.6 Codex usage whose trace omitted cache-write tokens. */
  unobservedCacheWriteTokens?: boolean;
  filePath: string;
}

/** How much of the parent is rendered, kept explicit so a timeless slice never masquerades as the whole session. */
export type RollupWindow =
  | { kind: "full" }
  | { kind: "range"; start: number; end: number }
  | { kind: "unknown" };

interface RollupDeps {
  discover: (parentFilePath: string) => Promise<string[]>;
  load: (childFilePath: string) => Promise<Session | null>;
}

const defaultDeps: RollupDeps = {
  discover: discoverChildFiles,
  load: (childFilePath) => loadById("claude-code", childFilePath),
};

/** True when the child's observable interval intersects the parent range. */
function childOverlaps(session: Session, window: RollupWindow): boolean {
  if (window.kind === "full") {
    return true;
  }
  if (window.kind === "unknown") {
    return false;
  }
  if (session.startedAt !== undefined && session.endedAt !== undefined) {
    return session.startedAt <= window.end && session.endedAt >= window.start;
  }
  const observed = session.startedAt ?? session.endedAt;
  return observed !== undefined && observed >= window.start && observed <= window.end;
}

/**
 * Discover and roll up the parent's subagent sessions. Returns one row per
 * child transcript that is either included by window overlap or unreadable
 * (unreadable rows are always listed so the count stays honest). Deterministic
 * order (children are discovered in sorted path order).
 */
export async function rollupChildren(
  parentFilePath: string,
  window: RollupWindow,
  deps: Partial<RollupDeps> = {},
  /** SPEC-0038 R3 dedup — children independently credited as contributors are skipped here (filePath key), so no token counts twice. */
  excluded?: ReadonlySet<string>,
): Promise<SubagentRow[]> {
  const { discover, load } = { ...defaultDeps, ...deps };
  const childFiles = await discover(parentFilePath);
  const rows: SubagentRow[] = [];
  for (const childFile of childFiles) {
    if (excluded?.has(childFile)) {
      continue;
    }
    const agentId = parseChildPath(childFile)?.agentId ?? childFile;
    let session: Session | null = null;
    try {
      session = await load(childFile);
    } catch {
      session = null;
    }
    if (!session) {
      rows.push({ name: agentId, usd: null, tokens: emptyUsage(), unreadable: true, filePath: childFile });
      continue;
    }
    if (!childOverlaps(session, window)) {
      continue;
    }
    const model = await buildReceiptModel(session);
    // A markup-shaped title (fork boilerplate, injected XML) is machine noise,
    // not a name — same rule the receipt masthead applies to its title line.
    const title = session.title?.replace(/\s+/g, " ").trim();
    rows.push({
      name: title !== undefined && title !== "" && !title.startsWith("<") ? title : `agent-${agentId}`,
      model: session.model,
      usd: model.totalUsd,
      tokens: model.totalTokens,
      ...(model.unpricedTokens ? { unpricedTokens: model.unpricedTokens } : {}),
      unreadable: false,
      ...(((session.droppedRecords ?? 0) > 0) ? { droppedRecords: session.droppedRecords } : {}),
      ...(model.unobservedCacheWriteTokens ? { unobservedCacheWriteTokens: true } : {}),
      filePath: childFile,
    });
  }
  return rows;
}
