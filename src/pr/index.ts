// SPEC-0019 — `aireceipts pr` orchestration. Selects the session that built the
// current branch (R1b/R1d, or explicit --session), slices it to this PR's turn
// range (R1e), rolls up subagents (R1c), and renders the body. R3 is the spine:
// the full pasteable body is ALWAYS written to stdout BEFORE any `gh` call, so a
// failed post can never eat the receipt. Selection errors (no/many matches)
// happen before there's anything to render and exit 1 with a stderr message.
import * as path from "node:path";
import { selectSummary } from "../parse/load.js";
import type { Session, SessionSummary } from "../parse/types.js";
import { buildReceiptModel, sliceSessionForReceipt } from "../receipt/model.js";
import { renderReceipt } from "../receipt/render.js";
import { branchCommits, defaultRunner, worktreeRoots, type CommandRunner } from "./git.js";
import { selectCandidates } from "./select.js";
import { computeSlice } from "./slice.js";
import { rollupChildren, type RollupWindow, type SubagentRow } from "./rollup.js";
import { renderPrBody } from "./body.js";
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
    listSessions: async () => (await import("../parse/load.js")).listSessions(),
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

/** Resolve the session to attribute: explicit --session, else auto-select by worktree + time. */
async function resolveSession(
  opts: PrOptions,
  deps: PrDeps,
  commitMs: readonly number[],
): Promise<{ summary: SessionSummary } | { error: string }> {
  const sessions = await deps.listSessions();
  if (opts.session) {
    const summary = selectSummary(sessions, opts.session);
    return summary ? { summary } : { error: `no session matched "${opts.session}"` };
  }
  if (sessions.length === 0) {
    return { error: "no agent sessions found on disk" };
  }
  const roots = worktreeRoots(deps.runGit, deps.cwd);
  const selection = selectCandidates(sessions, roots, commitMs);
  if (selection.kind === "none") {
    return { error: "no session matches this repo + branch; re-run with --session <id> to pick one explicitly" };
  }
  if (selection.kind === "many") {
    const ids = selection.matches
      .map((s) => `  ${path.basename(s.filePath).replace(/\.jsonl$/, "")}  ${s.title ?? ""}`.trimEnd())
      .join("\n");
    return { error: `multiple sessions match this branch — re-run with --session <id>:\n${ids}` };
  }
  return { summary: selection.summary };
}

/** `aireceipts pr [--post] [--session <id>]`. Returns the process exit code. */
export async function runPr(opts: PrOptions, deps: PrDeps = defaultPrDeps()): Promise<number> {
  // Branch SHAs + commit dates: SHAs slice (R1e), commit dates filter (R1d).
  const { shas, commitMs } = branchCommits(deps.runGit, deps.cwd);

  const resolved = await resolveSession(opts, deps, commitMs);
  if ("error" in resolved) {
    deps.err(resolved.error);
    return 1;
  }
  const session = await deps.loadSession(resolved.summary);
  if (!session) {
    deps.err(`failed to load session "${resolved.summary.id}"`);
    return 1;
  }

  const slice = computeSlice(session.turns, shas);
  const rendered = slice.kind === "slice" ? sliceSessionForReceipt(session, slice) : session;
  const model = await buildReceiptModel(rendered);
  const receiptText = renderReceipt(model, { color: false });

  const window: RollupWindow =
    slice.kind === "slice" && rendered.startedAt !== undefined && rendered.endedAt !== undefined
      ? { start: rendered.startedAt, end: rendered.endedAt }
      : null;
  const subagents = await deps.rollup(resolved.summary.filePath, window);

  const body = renderPrBody({
    sessionId: path.basename(resolved.summary.filePath).replace(/\.jsonl$/, ""),
    slice,
    receiptText,
    parentUsd: model.totalUsd,
    parentTokens: model.totalTokens,
    subagents,
  });

  // R3: render first, unconditionally — before any gh call.
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
