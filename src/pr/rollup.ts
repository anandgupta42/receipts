// SPEC-0019 R1c — roll subagent (child) sessions up into the parent's PR
// receipt. A child is included iff its own window overlaps the rendered parent
// slice (launch OR result inside — the straddle case: launched in-slice,
// finished after, still counts). A child that fails to parse is listed as
// `(unreadable)` and counted, never silently dropped. Children of a full-session
// fallback are all included (the window is the whole session).
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
  /** The child transcript could not be parsed — usd/tokens are unknown. */
  unreadable: boolean;
  filePath: string;
}

/** The inclusion window for a child: the rendered parent slice's time span, or `null` for a full-session render (include every child). */
export type RollupWindow = { start: number; end: number } | null;

interface RollupDeps {
  discover: (parentFilePath: string) => Promise<string[]>;
  load: (childFilePath: string) => Promise<Session | null>;
}

const defaultDeps: RollupDeps = {
  discover: discoverChildFiles,
  load: (childFilePath) => loadById("claude-code", childFilePath),
};

/** True if the child's launch (startedAt) OR result (endedAt) falls inside the window. */
function childOverlaps(session: Session, window: RollupWindow): boolean {
  if (window === null) {
    return true;
  }
  const inWindow = (t?: number) => t !== undefined && t >= window.start && t <= window.end;
  return inWindow(session.startedAt) || inWindow(session.endedAt);
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
): Promise<SubagentRow[]> {
  const { discover, load } = { ...defaultDeps, ...deps };
  const childFiles = await discover(parentFilePath);
  const rows: SubagentRow[] = [];
  for (const childFile of childFiles) {
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
    rows.push({
      name: session.title ?? agentId,
      model: session.model,
      usd: model.totalUsd,
      tokens: model.totalTokens,
      unreadable: false,
      filePath: childFile,
    });
  }
  return rows;
}
