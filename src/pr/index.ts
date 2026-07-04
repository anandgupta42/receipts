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
import { cacheServedPct, compactDuration } from "../receipt/present.js";
import { formatDuration, formatShortTokens } from "../receipt/format.js";
import { HELPER_FULL_LABEL } from "./body.js";
import { branchCommits, currentWorktreeRoot, defaultRunner, worktreeRoots, type CommandRunner } from "./git.js";
import { isBranchCandidate, overlapsBranchWindow, selectExplicitSession } from "./select.js";
import { computeSlice } from "./slice.js";
import { anchorEvents } from "./slice.js";
import { buildPerCommitRows, renderPerCommitLines, segmentSlice } from "./perCommit.js";
import { deriveRole, selectContributors, type PoolCandidate, type RawContributor } from "./contributors.js";
import { promoteOrphanSidechains } from "./promote.js";
import { rollupChildren, type RollupWindow, type SubagentRow } from "./rollup.js";
import { renderPrBody, type ContributorView, type PrBodyInput } from "./body.js";
import { repoVisibility, resolvePr, upsertPrComment } from "./comment.js";
import { artifactFileName, renderPrArtifactHtml, type ArtifactSession } from "./html.js";
import { ARTIFACT_BRANCH, artifactViewUrl, publishArtifact } from "./publish.js";
import { buildShareLines } from "./share.js";
import type { ReceiptModel } from "../receipt/model.js";

export interface PrOptions {
  post: boolean;
  session?: string;
  /** SPEC-0027: publish the HTML receipt artifact and link it (requires --post). */
  artifact?: boolean;
  /** SPEC-0026 R5: include the collapsed full-receipts section (default true; `--no-details` clears it). */
  details?: boolean;
  /** SPEC-0035 R5: print ready-to-paste share intent URLs to stderr (requires --artifact). */
  share?: boolean;
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
  subjects: readonly string[],
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
    branchSubjects: subjects,
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
    durationMs: model.durationMs,
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
  extras?: { notAttributable?: string[]; perCommitJson?: string },
): { fileName: string; url: string; ownerRepo: string } | null {
  const pr = resolvePr(deps.runGh);
  if (!pr.ok) {
    deps.err(`artifact skipped: ${pr.error}`);
    return null;
  }
  const fileName = artifactFileName(pr.prNumber);
  const content = renderPrArtifactHtml({ prNumber: pr.prNumber, body: bodyInput, sessions, ...extras });
  const repoUrl = `https://github.com/${pr.ownerRepo}.git`;
  // R4: the exact publish target, inspectable before anything is pushed.
  deps.err(`publishing ${fileName} to ${ARTIFACT_BRANCH} on ${repoUrl}`);
  const outcome = publishArtifact({ repoUrl, fileName, content, prNumber: pr.prNumber, run: deps.runGit });
  if (!outcome.ok) {
    deps.err(outcome.error);
    return null;
  }
  return { fileName, url: artifactViewUrl(pr.ownerRepo, fileName), ownerRepo: pr.ownerRepo };
}

/** Last `-`-segment, first 8 chars: `df374859-…-a613ae74b101` → `a613ae74`; codex rollout ids → hash tail. */
function shortSessionId(id: string): string {
  if (id.length <= 14) {
    return id;
  }
  const seg = id.split("-").pop() ?? id;
  return seg.length >= 8 ? seg.slice(0, 8) : id.slice(0, 12);
}

/** Everything after the role: id · slice/commits · turns · duration · tokens · cached (round 3 phrasing). */
function detailStats(view: ContributorView, model: ReceiptModel): string[] {
  const parts = [shortSessionId(view.sessionId)];
  parts.push(
    view.basis === "helper"
      ? HELPER_FULL_LABEL
      : view.slice.kind === "slice"
        ? `turns ${view.slice.startTurn + 1}–${view.slice.endTurn + 1} of ${view.slice.turnCount}`
        : (view.slice.label ?? "entire session"),
  );
  const turns = view.slice.kind === "slice" ? view.slice.endTurn - view.slice.startTurn + 1 : view.slice.turnCount;
  if (turns > 0) {
    parts.push(`${turns} turn${turns === 1 ? "" : "s"}`);
  }
  if (model.durationMs !== undefined) {
    parts.push(compactDuration(formatDuration(model.durationMs)));
  }
  const t = model.totalTokens;
  parts.push(`${formatShortTokens(t.input)} in / ${formatShortTokens(t.output)} out`);
  const pct = cacheServedPct(t);
  if (pct !== undefined) {
    parts.push(`${pct}% cached`);
  }
  return parts;
}

/** Plain stat line for the artifact page (no markdown). */
function detailLabel(view: ContributorView, model: ReceiptModel): string {
  return [view.role, ...detailStats(view, model)].join(" · ");
}

/** Ledger-table row for the details section: [session, id, scope, turns, time, tokens, cached]. */
function detailRow(view: ContributorView, model: ReceiptModel): string[] {
  const scope =
    view.basis === "helper"
      ? HELPER_FULL_LABEL
      : view.slice.kind === "slice"
        ? `turns ${view.slice.startTurn + 1}–${view.slice.endTurn + 1} of ${view.slice.turnCount}`
        : (view.slice.label ?? "entire session");
  const turns = view.slice.kind === "slice" ? view.slice.endTurn - view.slice.startTurn + 1 : view.slice.turnCount;
  const t = model.totalTokens;
  const pct = cacheServedPct(t);
  return [
    `**${view.role}**`,
    `\`${shortSessionId(view.sessionId)}\``,
    scope,
    turns > 0 ? String(turns) : "—",
    model.durationMs !== undefined ? compactDuration(formatDuration(model.durationMs)) : "—",
    `${formatShortTokens(t.input)} / ${formatShortTokens(t.output)}`,
    pct !== undefined ? `${pct}%` : "—",
  ];
}

/** Small heading over each receipt in the details section. */
function detailHeading(view: ContributorView): string {
  return `#### ${view.role} · \`${shortSessionId(view.sessionId)}\``;
}

/** `aireceipts pr [--post] [--session <id>] [--artifact]`. Returns the process exit code. */
export async function runPr(opts: PrOptions, deps: PrDeps = defaultPrDeps()): Promise<number> {
  // R4 (SPEC-0027): the artifact exists to be linked — reject before rendering.
  if (opts.artifact && !opts.post) {
    deps.err("--artifact requires --post");
    return 1;
  }
  // SPEC-0035 R5: the share hint targets the artifact link — same shape as the guard above.
  if (opts.share && !opts.artifact) {
    deps.err("--share requires --artifact");
    return 1;
  }

  // Branch SHAs + commit dates: SHAs anchor/slice (R1/R1e), commit dates filter candidates (R1d).
  const branchInfo = branchCommits(deps.runGit, deps.cwd);
  const { shas, commitMs } = branchInfo;

  const resolved = await resolveContributors(opts, deps, shas, commitMs, branchInfo.subjects);
  if ("error" in resolved) {
    deps.err(resolved.error);
    return 1;
  }

  // SPEC-0024 R3 ordering: base views first (their rollups define what is
  // already counted), then promotion of uncovered anchored sidechains, then
  // one chronological sort across both (startedAt, then id — SPEC-0023 order).
  const entries: { view: ContributorView; model: ReceiptModel; startedAt: number; id: string; raw: RawContributor }[] = [];
  const covered = new Set<string>();
  for (const raw of resolved.contributors) {
    const { view, model } = await buildContributorView(raw, deps);
    covered.add(raw.summary.filePath);
    for (const row of view.subagents) {
      covered.add(row.filePath);
    }
    entries.push({ view, model, startedAt: raw.session.startedAt ?? 0, id: raw.summary.id, raw });
  }
  const promoted = await promoteOrphanSidechains(resolved.sidechains, shas, covered, deps.loadSession);
  for (const raw of promoted) {
    const { view, model } = await buildContributorView(raw, deps);
    entries.push({ view, model, startedAt: raw.session.startedAt ?? 0, id: raw.summary.id, raw });
  }
  if (entries.length === 0) {
    deps.err(NO_MATCH);
    return 1;
  }
  entries.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  // Round 2: the fence renders authors first, helpers grouped after — the
  // details section and the artifact page must show the SAME order, so the
  // size-cap's drop-from-END sheds helpers before authors.
  const fenceOrdered = [...entries.filter((e) => e.view.basis !== "helper"), ...entries.filter((e) => e.view.basis === "helper")];
  const views = entries.map((e) => e.view);
  const bodyInput: PrBodyInput = { contributors: views, excludedCount: resolved.excludedCount };

  // SPEC-0027 R3: push the artifact BEFORE rendering the one final body, so
  // the printed and posted bodies are identical and the link only renders
  // after a confirmed push. A failed publish still posts (additive-only).
  let artifactFailed = false;
  let link: { fileName: string; url: string; ownerRepo: string } | null = null;
  if (opts.artifact) {
    // SPEC-0031 R3a — per-commit tables for sliced sessions; everything else
    // (helpers, full fallbacks) lands in the labeled bucket. The slicer's own
    // refusal to cut a session is honored here: no table where no slice.
    const sessions: ArtifactSession[] = [];
    const islandData: { session: string; rows: unknown[] }[] = [];
    const notAttributable: string[] = [];
    for (const e of fenceOrdered) {
      const label = detailLabel(e.view, e.model);
      const segments = segmentSlice(e.raw.slice, anchorEvents(e.raw.session.turns, branchInfo.shas), branchInfo);
      if (segments.length === 0) {
        notAttributable.push(label);
        sessions.push({ label, model: e.model });
        continue;
      }
      const rows = await buildPerCommitRows(e.raw.session, segments);
      islandData.push({ session: e.view.sessionId, rows });
      sessions.push({ label, model: e.model, perCommitLines: renderPerCommitLines(rows) });
    }
    link = publishAndLink(bodyInput, sessions, deps, {
      notAttributable: notAttributable.length === fenceOrdered.length ? notAttributable : notAttributable.length > 0 ? notAttributable : undefined,
      perCommitJson: islandData.length > 0 ? JSON.stringify(islandData) : undefined,
    });
    artifactFailed = link === null;
  }
  // SPEC-0026 R5 (round 2) — per-session full receipts, collapsed, unless
  // --no-details. The label is the stat line: everything the fence dropped
  // (id, slice reason) plus the session's anatomy, in one place.
  const details = opts.details === false ? undefined : fenceOrdered.map((e) => ({ label: detailHeading(e.view), row: detailRow(e.view, e.model), text: renderReceipt(e.model, { color: false }) }));
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
  // SPEC-0035 R5: only after BOTH the push (link !== null) AND the upsert
  // (result.ok, just confirmed above) succeed — never advertise a receipt
  // whose comment failed to post. Text only; no network from this branch.
  // S5 (Codex finding 3): the artifact and the comment each resolved the PR
  // independently — the hint prints only when both landed on the SAME PR, so
  // a mid-command `gh pr view` flip can never share pr-N.html for PR M.
  // Maintainer review (PR #87): a private repo's artifact 404s for every
  // reader — the viewer chrome already refuses share on a failed load, and
  // the CLI hint must not hand out intent URLs the viewer will reject.
  // Tightened per that review's Codex round: intent URLs print only on a
  // POSITIVE public answer (one gh call, --share path only); an errored
  // check skips neutrally, and the match guard covers owner/repo too.
  if (opts.share && link !== null) {
    if (link.fileName !== artifactFileName(result.prNumber) || link.ownerRepo !== result.ownerRepo) {
      deps.err(`share hint skipped: artifact ${link.ownerRepo}/${link.fileName} does not match comment PR ${result.ownerRepo}#${result.prNumber}`);
    } else {
      const visibility = repoVisibility(link.ownerRepo, deps.runGh);
      if (visibility === "public") {
        for (const line of buildShareLines(link.url)) {
          deps.err(line);
        }
      } else if (visibility === "private") {
        deps.err("share: skipped — repo is private; the viewer cannot render this for readers (works automatically once the repo is public)");
      } else {
        deps.err("share: skipped — could not verify repo visibility");
      }
    }
  }
  return artifactFailed ? 1 : 0;
}
