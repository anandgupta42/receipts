// SPEC-0038 R3 — nested subagent transcripts become PR candidates. Top-level
// discovery deliberately excludes `<stem>/subagents/*.jsonl` (SPEC-0023 R1c:
// children roll UP, they don't stand alone) — which made the sessions that
// actually built PRs #79/#86 invisible to attribution. Here they are admitted
// as candidates under the SAME gates as everyone else (cwd/repo pools, anchor
// evidence); double-counting is prevented at the rollup (a nested contributor
// is excluded from its parent's SUBAGENTS block by filePath — R3 dedup).
import * as path from "node:path";
import { discoverChildFiles, parseChildPath } from "../parse/children.js";
import { loadById } from "../parse/load.js";
import type { Session, SessionSummary } from "../parse/types.js";
import { overlapsBranchWindow } from "./select.js";

export interface NestedCandidate {
  summary: SessionSummary;
  /** Loaded once at discovery (the summary is synthesized from it) — selection reuses this instead of re-loading by id. */
  session: Session;
}

export interface NestedDeps {
  discover: (parentFilePath: string) => Promise<string[]>;
  load: (childFilePath: string) => Promise<Session | null>;
}

const defaultDeps: NestedDeps = {
  discover: discoverChildFiles,
  load: (childFilePath) => loadById("claude-code", childFilePath),
};

/**
 * Discover nested subagent sessions under the branch-window-overlapping
 * Claude Code parents. The synthesized summary's `id` is the agent stem —
 * fork transcripts reuse the PARENT's `sessionId` in their records, so the
 * file stem is the only honest identity (same rule the rollup uses). One
 * `subagents/` level only (SPEC-0038 non-goal: no recursive nesting).
 */
export async function nestedCandidates(
  topLevel: readonly SessionSummary[],
  commitMs: readonly number[],
  deps: Partial<NestedDeps> = {},
): Promise<NestedCandidate[]> {
  const { discover, load } = { ...defaultDeps, ...deps };
  const out: NestedCandidate[] = [];
  for (const parent of topLevel) {
    if (parent.source !== "claude-code" || !overlapsBranchWindow(parent, commitMs)) {
      continue;
    }
    let childFiles: string[];
    try {
      childFiles = await discover(parent.filePath);
    } catch {
      continue;
    }
    // Direct children only (`<stem>/subagents/agent-*.jsonl`): the discovery
    // walk is recursive, but SPEC-0038's non-goal excludes deeper nesting —
    // a grandchild admitted here could roll up twice (S5 finding 7). Capped
    // as a runaway bound (S5 finding 8); the overlap gate bounds parents.
    const directDir = path.join(parent.filePath.replace(/\.jsonl$/, ""), "subagents");
    let admitted = 0;
    for (const childFile of childFiles) {
      if (path.dirname(childFile) !== directDir || admitted >= 200) {
        continue;
      }
      const agentId = parseChildPath(childFile)?.agentId;
      if (!agentId) {
        continue;
      }
      admitted++;
      let session: Session | null = null;
      try {
        session = await load(childFile);
      } catch {
        session = null;
      }
      if (!session) {
        continue; // unreadable children stay rollup-only (honest counted absence there)
      }
      out.push({
        summary: {
          id: agentId,
          source: "claude-code",
          filePath: childFile,
          title: session.title,
          model: session.model,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          cwd: session.cwd,
          totals: {
            tokens: session.totals.tokens,
            durationMs: session.totals.durationMs,
            turnCount: session.turns.length,
            toolCallCount: session.totals.toolCallCount,
          },
        },
        session,
      });
    }
  }
  return out;
}
