// SPEC-0019 R1c — the parse layer's child (subagent) index. Children live under
// `<parentSessionId>/subagents/` (any depth) as `agent-<agentId>.jsonl`, beside
// the parent transcript `<parentSessionId>.jsonl`. This module maps a child path
// back to its parent (used when parsing a child) and discovers a parent's
// children on disk (used by `aireceipts pr` to roll up subagent cost).
// Attribution-only — nothing here feeds pricing, rendering, or telemetry.
import * as path from "node:path";
import { listFiles } from "./util.js";

/** The subagent directory segment that marks a transcript as a child. */
const SUBAGENTS_SEGMENT = "subagents";
const CHILD_BASENAME_RE = /^agent-(.+)\.jsonl$/;

export interface ChildRef {
  agentId: string;
  parentSessionId: string;
  parentFilePath: string;
}

/**
 * If `filePath` is a subagent transcript (an `agent-<agentId>.jsonl` file under
 * a `<parentSessionId>/subagents/` directory, at any depth), return its parent
 * linkage; otherwise `null`. Path-based (not content-based) so the top-level
 * session list can exclude children without parsing them.
 */
export function parseChildPath(filePath: string): ChildRef | null {
  const segments = filePath.split(path.sep);
  const subIdx = segments.indexOf(SUBAGENTS_SEGMENT);
  if (subIdx <= 0) {
    return null;
  }
  const base = segments[segments.length - 1];
  const m = CHILD_BASENAME_RE.exec(base);
  if (!m) {
    return null;
  }
  // The directory immediately before `subagents/` is named for the parent session.
  const parentSessionId = segments[subIdx - 1];
  if (!parentSessionId) {
    return null;
  }
  const parentDir = segments.slice(0, subIdx - 1).join(path.sep);
  const parentFilePath = path.join(parentDir, `${parentSessionId}.jsonl`);
  return { agentId: m[1], parentSessionId, parentFilePath };
}

/** True if `filePath` is a subagent transcript (excluded from top-level selection). */
export function isChildPath(filePath: string): boolean {
  return parseChildPath(filePath) !== null;
}

/**
 * Discover the subagent transcripts of a parent transcript on disk, in sorted
 * path order (deterministic). Returns absolute file paths under
 * `<parentDir>/<parentStem>/subagents/`. Empty when the parent has no children.
 */
export async function discoverChildFiles(parentFilePath: string): Promise<string[]> {
  const parentDir = path.dirname(parentFilePath);
  const parentStem = path.basename(parentFilePath).replace(/\.jsonl$/, "");
  const childrenRoot = path.join(parentDir, parentStem, SUBAGENTS_SEGMENT);
  const files = await listFiles(childrenRoot, (name) => CHILD_BASENAME_RE.test(name));
  return files.sort();
}
