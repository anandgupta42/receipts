// SPEC-0023 (widens SPEC-0019) + SPEC-0024 — `aireceipts pr` orchestration.
// Selects EVERY session that built the current branch: the repo pool (cwd in a
// worktree; Claude by branch-SHA anchor, Codex by cwd+time) plus SPEC-0024's
// anchor pool (any time-overlapping session — cross-repo leads — credited on
// an own branch-SHA anchor ONLY). Each contributor is sliced to its PR turn
// range (R1e), its subagents rolled up (R1c), then orphan SHA-anchored listed
// sidechains no rollup covers are promoted (SPEC-0024 R2/R3) and the merged
// set sorts chronologically. R3 of SPEC-0019 is still the spine: the full
// pasteable body is ALWAYS written to stdout BEFORE any `gh` call.
// `--session <id>` still resolves exactly one session (R5).
import * as path from "node:path";
import type { Session, SessionSummary } from "../parse/types.js";
import { buildReceiptModel, sliceSessionForReceipt } from "../receipt/model.js";
import { renderReceipt } from "../receipt/render.js";
import { branchCommits, currentWorktreeRoot, defaultRunner, worktreeRoots, type CommandRunner } from "./git.js";
import { isBranchCandidate, overlapsBranchWindow, selectExplicitSession } from "./select.js";
import { computeSlice } from "./slice.js";
import { deriveRole, selectContributors, type PoolCandidate, type RawContributor } from "./contributors.js";
import { promoteOrphanSidechains } from "./promote.js";
import { rollupChildren, type RollupWindow, type SubagentRow } from "./rollup.js";
import { renderPrBody, type ContributorView, type PrBodyInput } from "./body.js";
import { resolvePr, upsertPrComment } from "./comment.js";
import { artifactFileName, renderPrArtifactHtml, type ArtifactSession } from "./html.js";
import { ARTIFACT_BRANCH, publishArtifact } from "./publish.js";
import type { ReceiptModel } from "../receipt/model.js";

export interface PrOptions {
  post: boolean;
  session?: string;
  /** SPEC-0027: publish the HTML receipt artifact and link it (requires --post). */
  artifact?: boolean;
  /** SPEC-0026 R5: include the collapsed full-receipts section (default true; `--no-details` clears it). */
  details?: boolean;
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

interface Resolved {
  contributors: RawContributor[];
  excludedCount: number;
  /** Time-overlapping listed sidechains — SPEC-0024 R2 promotion candidates, judged after rollups. */
  sidechains: SessionSummary[];
}

/**
 * Resolve the contributor set: explicit --session → exactly one (R5); else the
 * conservative auto-selected union of the repo pool and SPEC-0024's anchor
 * pool (R1). Sidechain candidates are returned for the post-rollup promotion
 * pass, so an empty contributor list here is not yet a NO_MATCH — `runPr`
 * decides after promotion (SPEC-0024 R4).
 */
async function resolveContributors(
  opts: PrOptions,
  deps: PrDeps,
  shas: readonly string[],
  commitMs: readonly number[],
): Promise<Resolved | { error: string }> {
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
    return {
      // Explicitly-selected sessions are the user's own attribution claim — anchor-grade.
      contributors: [{ summary, session, slice: computeSlice(session.turns, shas), basis: "anchor" }],
      excludedCount: 0,
      sidechains: [],
    };
  }

  if (sessions.length === 0) {
    return { error: "no agent sessions found on disk" };
  }
  const roots = worktreeRoots(deps.runGit, deps.cwd);
  const candidates: PoolCandidate[] = [];
  const sidechains: SessionSummary[] = [];
  for (const s of sessions) {
    if (isBranchCandidate(s, roots, commitMs)) {
      candidates.push({ summary: s, pool: "repo" });
    } else if (overlapsBranchWindow(s, commitMs)) {
      // SPEC-0024 R1/R2 — time-overlapping but outside the repo pool: flagged
      // sidechains queue for promotion; everything else (cross-repo leads,
      // no-cwd sessions) joins the anchor pool, credited on SHA proof only.
      if (s.isSidechain === true) {
        sidechains.push(s);
      } else {
        candidates.push({ summary: s, pool: "anchor" });
      }
    }
  }
  if (candidates.length === 0 && sidechains.length === 0) {
    return { error: NO_MATCH };
  }
  const selection = await selectContributors(candidates, shas, {
    loadSession: deps.loadSession,
    currentWorktreeRoot: currentWorktreeRoot(deps.runGit, deps.cwd) ?? deps.cwd,
  });
  return { ...selection, sidechains };
}

/**
 * Slice → price → roll up → role each contributor into what the comment
 * renders (R2/R3). The sliced `ReceiptModel` is returned alongside the view —
 * SPEC-0027's artifact page renders it in full instead of discarding it.
 */
async function buildContributorView(raw: RawContributor, deps: PrDeps): Promise<{ view: ContributorView; model: ReceiptModel }> {
  const rendered = raw.slice.kind === "slice" ? sliceSessionForReceipt(raw.session, raw.slice) : raw.session;
  const model = await buildReceiptModel(rendered);
  const window: RollupWindow =
    raw.slice.kind === "slice" && rendered.startedAt !== undefined && rendered.endedAt !== undefined
      ? { start: rendered.startedAt, end: rendered.endedAt }
      : null;
  const subagents = await deps.rollup(raw.summary.filePath, window);
  const view: ContributorView = {
    role: deriveRole(raw.summary, raw.session, subagents.length > 0),
    sessionId: stemOf(raw.summary.filePath),
    slice: raw.slice,
    modelMix: model.modelMix,
    usd: model.totalUsd,
    tokens: model.totalTokens,
    subagents,
    basis: raw.basis,
  };
  return { view, model };
}

/**
 * SPEC-0027 R2/R3: build the artifact from the retained models and push it to
 * the base repo's artifact branch. Returns the confirmed link, or `null` with
 * the failure already written to stderr — the caller renders the one final
 * body either way (a link never outruns its artifact, kill criterion c).
 */
function publishAndLink(
  bodyInput: PrBodyInput,
  sessions: ArtifactSession[],
  deps: PrDeps,
): { fileName: string; url: string } | null {
  const pr = resolvePr(deps.runGh);
  if (!pr.ok) {
    deps.err(`artifact skipped: ${pr.error}`);
    return null;
  }
  const fileName = artifactFileName(pr.prNumber);
  const content = renderPrArtifactHtml({ prNumber: pr.prNumber, body: bodyInput, sessions });
  const repoUrl = `https://github.com/${pr.ownerRepo}.git`;
  // R4: the exact publish target, inspectable before anything is pushed.
  deps.err(`publishing ${fileName} to ${ARTIFACT_BRANCH} on ${repoUrl}`);
  const outcome = publishArtifact({ repoUrl, fileName, content, prNumber: pr.prNumber, run: deps.runGit });
  if (!outcome.ok) {
    deps.err(outcome.error);
    return null;
  }
  return { fileName, url: `https://github.com/${pr.ownerRepo}/blob/${ARTIFACT_BRANCH}/${fileName}` };
}

/** `aireceipts pr [--post] [--session <id>] [--artifact]`. Returns the process exit code. */
export async function runPr(opts: PrOptions, deps: PrDeps = defaultPrDeps()): Promise<number> {
  // R4 (SPEC-0027): the artifact exists to be linked — reject before rendering.
  if (opts.artifact && !opts.post) {
    deps.err("--artifact requires --post");
    return 1;
  }

  // Branch SHAs + commit dates: SHAs anchor/slice (R1/R1e), commit dates filter candidates (R1d).
  const { shas, commitMs } = branchCommits(deps.runGit, deps.cwd);

  const resolved = await resolveContributors(opts, deps, shas, commitMs);
  if ("error" in resolved) {
    deps.err(resolved.error);
    return 1;
  }

  // SPEC-0024 R3 ordering: base views first (their rollups define what is
  // already counted), then promotion of uncovered anchored sidechains, then
  // one chronological sort across both (startedAt, then id — SPEC-0023 order).
  const entries: { view: ContributorView; model: ReceiptModel; startedAt: number; id: string }[] = [];
  const covered = new Set<string>();
  for (const raw of resolved.contributors) {
    const { view, model } = await buildContributorView(raw, deps);
    covered.add(raw.summary.filePath);
    for (const row of view.subagents) {
      covered.add(row.filePath);
    }
    entries.push({ view, model, startedAt: raw.session.startedAt ?? 0, id: raw.summary.id });
  }
  const promoted = await promoteOrphanSidechains(resolved.sidechains, shas, covered, deps.loadSession);
  for (const raw of promoted) {
    const { view, model } = await buildContributorView(raw, deps);
    entries.push({ view, model, startedAt: raw.session.startedAt ?? 0, id: raw.summary.id });
  }
  if (entries.length === 0) {
    deps.err(NO_MATCH);
    return 1;
  }
  entries.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const views = entries.map((e) => e.view);
  const bodyInput: PrBodyInput = { contributors: views, excludedCount: resolved.excludedCount };

  // SPEC-0027 R3: push the artifact BEFORE rendering the one final body, so
  // the printed and posted bodies are identical and the link only renders
  // after a confirmed push. A failed publish still posts (additive-only).
  let artifactFailed = false;
  let link: { fileName: string; url: string } | null = null;
  if (opts.artifact) {
    const sessions: ArtifactSession[] = entries.map((e) => ({ label: `${e.view.role} · ${e.view.sessionId}`, model: e.model }));
    link = publishAndLink(bodyInput, sessions, deps);
    artifactFailed = link === null;
  }
  // SPEC-0026 R5 — per-session full receipts, collapsed, unless --no-details.
  const details =
    opts.details === false
      ? undefined
      : entries.map((e) => ({
          label: `${e.view.role} · ${e.view.sessionId}`,
          text: renderReceipt(e.model, { color: false }),
        }));
  const body = renderPrBody(bodyInput, { artifactLink: link ?? undefined, details });

  // R3 (SPEC-0019): render before the comment upsert, unconditionally.
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
  return artifactFailed ? 1 : 0;
}
