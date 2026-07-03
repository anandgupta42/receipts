// SPEC-0023 (widens SPEC-0019) — `aireceipts pr` orchestration. Selects EVERY
// session that built the current branch (R1: Claude by branch-SHA anchor, Codex
// by cwd+time), slices each to its own PR turn range (R1e), rolls up each one's
// subagents (R1c), labels a descriptive role (R3), and renders one body with
// per-session rows + a single combined total (R4). R3 of SPEC-0019 is still the
// spine: the full pasteable body is ALWAYS written to stdout BEFORE any `gh`
// call. `--session <id>` still resolves exactly one session (R5).
import * as path from "node:path";
import type { Session, SessionSummary } from "../parse/types.js";
import { buildReceiptModel, sliceSessionForReceipt } from "../receipt/model.js";
import { branchCommits, currentWorktreeRoot, defaultRunner, worktreeRoots, type CommandRunner } from "./git.js";
import { isBranchCandidate, selectExplicitSession } from "./select.js";
import { computeSlice } from "./slice.js";
import { deriveRole, selectContributors, type RawContributor } from "./contributors.js";
import { rollupChildren, type RollupWindow, type SubagentRow } from "./rollup.js";
import { renderPrBody, type ContributorView } from "./body.js";
import { upsertPrComment } from "./comment.js";

export interface PrOptions {
  post: boolean;
  session?: string;
}

export interface PrDeps {
  listSessions: () => Promise<SessionSummary[]>;
  loadSession: (summary: SessionSummary) => Promise<Session | null>;
  runGit: CommandRunner;
  runGh: CommandRunner;
  rollup: (parentFilePath: string, window: RollupWindow) => Promise<SubagentRow[]>;
  cwd: string;
  out: (s: string) => void;
  err: (s: string) => void;
}

export function defaultPrDeps(overrides: Partial<PrDeps> = {}): PrDeps {
  return {
    listSessions: async () => (await import("../parse/load.js")).listFullSessions(),
    loadSession: async (summary) => (await import("../parse/load.js")).loadSession(summary),
    runGit: defaultRunner,
    runGh: defaultRunner,
    rollup: (parentFilePath, window) => rollupChildren(parentFilePath, window),
    cwd: process.cwd(),
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
    ...overrides,
  };
}

const NO_MATCH = "no session matches this repo + branch; re-run with --session <id> to pick one explicitly";

function stemOf(filePath: string): string {
  return path.basename(filePath).replace(/\.jsonl$/, "");
}

/** Resolve the contributor set: explicit --session → exactly one (R5); else the conservative auto-selected set (R1). */
async function resolveContributors(
  opts: PrOptions,
  deps: PrDeps,
  shas: readonly string[],
  commitMs: readonly number[],
): Promise<{ contributors: RawContributor[]; excludedCount: number } | { error: string }> {
  const sessions = await deps.listSessions();

  if (opts.session) {
    const summary = await selectExplicitSession(sessions, opts.session);
    if (!summary) {
      return { error: `no session matched "${opts.session}"` };
    }
    const session = await deps.loadSession(summary);
    if (!session) {
      return { error: `failed to load session "${summary.id}"` };
    }
    return { contributors: [{ summary, session, slice: computeSlice(session.turns, shas) }], excludedCount: 0 };
  }

  if (sessions.length === 0) {
    return { error: "no agent sessions found on disk" };
  }
  const roots = worktreeRoots(deps.runGit, deps.cwd);
  const candidates = sessions.filter((s) => isBranchCandidate(s, roots, commitMs));
  if (candidates.length === 0) {
    return { error: NO_MATCH };
  }
  const selection = await selectContributors(candidates, shas, {
    loadSession: deps.loadSession,
    currentWorktreeRoot: currentWorktreeRoot(deps.runGit, deps.cwd) ?? deps.cwd,
  });
  if (selection.contributors.length === 0) {
    return { error: NO_MATCH };
  }
  return selection;
}

/** Slice → price → roll up → role each contributor into what the comment renders (R2/R3). */
async function buildContributorView(raw: RawContributor, deps: PrDeps): Promise<ContributorView> {
  const rendered = raw.slice.kind === "slice" ? sliceSessionForReceipt(raw.session, raw.slice) : raw.session;
  const model = await buildReceiptModel(rendered);
  const window: RollupWindow =
    raw.slice.kind === "slice" && rendered.startedAt !== undefined && rendered.endedAt !== undefined
      ? { start: rendered.startedAt, end: rendered.endedAt }
      : null;
  const subagents = await deps.rollup(raw.summary.filePath, window);
  return {
    role: deriveRole(raw.summary, raw.session, subagents.length > 0),
    sessionId: stemOf(raw.summary.filePath),
    slice: raw.slice,
    modelMix: model.modelMix,
    usd: model.totalUsd,
    tokens: model.totalTokens,
    subagents,
  };
}

/** `aireceipts pr [--post] [--session <id>]`. Returns the process exit code. */
export async function runPr(opts: PrOptions, deps: PrDeps = defaultPrDeps()): Promise<number> {
  // Branch SHAs + commit dates: SHAs anchor/slice (R1/R1e), commit dates filter candidates (R1d).
  const { shas, commitMs } = branchCommits(deps.runGit, deps.cwd);

  const resolved = await resolveContributors(opts, deps, shas, commitMs);
  if ("error" in resolved) {
    deps.err(resolved.error);
    return 1;
  }

  const views: ContributorView[] = [];
  for (const raw of resolved.contributors) {
    views.push(await buildContributorView(raw, deps));
  }
  const body = renderPrBody({ contributors: views, excludedCount: resolved.excludedCount });

  // R3 (SPEC-0019): render first, unconditionally — before any gh call.
  deps.out(body);

  if (!opts.post) {
    return 0;
  }

  const result = upsertPrComment(body, deps.runGh);
  if (!result.ok) {
    deps.err(result.error);
    return 1;
  }
  deps.err(`posted receipt (${result.action}) to PR #${result.prNumber}`);
  return 0;
}
