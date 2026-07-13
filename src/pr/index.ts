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
import { branchCommits, currentBranchName, currentWorktreeRoot, defaultRunner, worktreeRoots, type CommandRunner } from "./git.js";
import { isBranchCandidate, overlapsBranchWindow, selectExplicitSession } from "./select.js";
import { computeSlice } from "./slice.js";
import { anchorEvents } from "./slice.js";
import { buildPerCommitRows, renderPerCommitLines, segmentSlice } from "./perCommit.js";
import { deriveRole, selectContributors, type PoolCandidate, type RawContributor } from "./contributors.js";
import { promoteOrphanSidechains } from "./promote.js";
import { rollupChildren, type RollupWindow, type SubagentRow } from "./rollup.js";
import { nestedCandidates } from "./nested.js";
import { discoverChildFiles, isChildPath } from "../parse/children.js";
import {
  buildHandoffSlip,
  renderPrBodyDetailed,
  subagentDetailsTable,
  type ContributorView,
  type HandoffSectionData,
  type HandoffSlipView,
  type PrBodyExtras,
  type PrBodyInput,
} from "./body.js";
import { summarizeConfidence, type ConfidenceEvent } from "./confidence.js";
import { repoVisibility, resolvePr, upsertPrComment } from "./comment.js";
import { artifactFileName, renderPrArtifactHtml, type ArtifactSession } from "./html.js";
import { ARTIFACT_BRANCH, artifactViewUrl, publishArtifact } from "./publish.js";
import { buildShareLines } from "./share.js";
import type { ReceiptModel } from "../receipt/model.js";
import type { ResultValue, StepResultValue } from "../telemetry/schemas.js";
import { buildPrReceiptPayload, canonicalEndedAtMs, serializePrReceipt } from "./payload.js";
import { receiptRefSlug } from "./payloadTypes.js";
import { pushReceiptRef, writeReceiptRef } from "./store.js";

export interface PrOptions {
  post: boolean;
  /** SPEC-0023 R5 compatibility: one selector still replaces auto-selection. */
  session?: string;
  /** Issue #234: two or more explicit selectors append to the conservative auto-selected set. */
  sessions?: readonly string[];
  /** SPEC-0027: publish the HTML receipt artifact and link it (requires --post). */
  artifact?: boolean;
  /** SPEC-0026 R5: include the collapsed full-receipts section (default true; `--no-details` clears it). */
  details?: boolean;
  /** SPEC-0035 R5: print ready-to-paste share intent URLs to stderr (requires --artifact). */
  share?: boolean;
  /** SPEC-0065 R1: where the receipt is persisted. Precedence: flag > `AIRECEIPTS_STORE` env > default `"comment"`. */
  store?: "comment" | "ref";
  /** SPEC-0065 R2: after a successful `store=ref` write, also push the ref to `origin`. Best-effort — never fails the command. */
  pushRef?: boolean;
  /** SPEC-0070 R1: opt the `buy me a samosa` tip link back onto the comment + artifact (off by default). */
  samosa?: boolean;
}

export interface PrDeps {
  listSessions: () => Promise<SessionSummary[]>;
  loadSession: (summary: SessionSummary) => Promise<Session | null>;
  runGit: CommandRunner;
  runGh: CommandRunner;
  rollup: (parentFilePath: string, window: RollupWindow, excluded?: ReadonlySet<string>) => Promise<SubagentRow[]>;
  cwd: string;
  out: (s: string) => void;
  err: (s: string) => void;
}

export interface PrReceiptTelemetry {
  models: ReceiptModel[];
  turnCount: number;
  toolCallCount: number;
}

export interface PrRunResult {
  code: number;
  bodyRendered: boolean;
  contributorCount: number;
  receipt?: PrReceiptTelemetry;
  commentResult: StepResultValue;
  artifactResult: StepResultValue;
  shareResult: StepResultValue;
  /** SPEC-0059 R8 — the rendered body carried the handoff section (the kill criterion's observable denominator). */
  handoffSectionIncluded: boolean;
  result: ResultValue;
}

export function defaultPrDeps(overrides: Partial<PrDeps> = {}): PrDeps {
  return {
    // SPEC-0045 R3 — only the PR flow opts into degraded summaries (so it can
    // flag a repo-scoped unreadable session, R2); every other surface excludes
    // them by default.
    listSessions: async () => (await import("../parse/load.js")).listFullSessions(undefined, { includeDegraded: true }),
    loadSession: async (summary) => (await import("../parse/load.js")).loadSession(summary),
    runGit: defaultRunner,
    runGh: defaultRunner,
    rollup: (parentFilePath, window, excluded) => rollupChildren(parentFilePath, window, {}, excluded),
    cwd: process.cwd(),
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
    ...overrides,
  };
}

const NO_MATCH = "no session matches this repo + branch; re-run with --session <id> to pick one explicitly";

function prResult(input: Partial<PrRunResult> & { code: number; result: ResultValue }): PrRunResult {
  return {
    bodyRendered: false,
    contributorCount: 0,
    commentResult: "skipped",
    artifactResult: "skipped",
    handoffSectionIncluded: false,
    shareResult: "skipped",
    ...input,
  };
}

function stemOf(filePath: string): string {
  return path.basename(filePath).replace(/\.jsonl$/, "");
}

/**
 * SPEC-0044 B5 — true if `candidate`'s file lives anywhere under
 * `ancestorFilePath`'s own `subagents/` subtree (any depth). Used to scope a
 * promoted contributor's territory to whichever OTHER contributor is its
 * actual ancestor, so a deeper promoted grandchild's territory is carved out
 * of its immediate promoted parent's exclusion set too (not just the
 * top-level ancestor's) — see `exclusionsFor` below.
 */
function isDescendantOfContributor(candidate: string, ancestorFilePath: string): boolean {
  const root = path.join(ancestorFilePath.replace(/\.jsonl$/, ""), "subagents") + path.sep;
  return candidate.startsWith(root);
}

interface Resolved {
  contributors: RawContributor[];
  excludedCount: number;
  /** SPEC-0044 R1 — typed drop/degrade events (A1 anchor-pool absences etc.). */
  events: ConfidenceEvent[];
  /** Time-overlapping listed sidechains — SPEC-0024 R2 promotion candidates, judged after rollups. */
  sidechains: SessionSummary[];
}

/**
 * Resolve the contributor set: one explicit --session → exactly one (R5);
 * repeated --session flags → the conservative auto-selected union plus every
 * explicit attachment (#234), de-duplicated by transcript file. Sidechain
 * candidates are returned for the post-rollup promotion pass, so an empty
 * contributor list here is not yet a NO_MATCH — `runPr` decides after
 * promotion (SPEC-0024 R4).
 */
async function resolveContributors(
  opts: PrOptions,
  deps: PrDeps,
  shas: readonly string[],
  commitMs: readonly number[],
  subjects: readonly string[],
): Promise<Resolved | { error: string }> {
  const sessions = await deps.listSessions();
  // SPEC-0038 R3 — nested subagent sessions of window-overlapping Claude
  // parents join the candidate set under the same gates (and are explicitly
  // selectable). Loaded once here; selection reuses the preloaded sessions.
  const nested = await nestedCandidates(sessions, commitMs);
  const preloaded = new Map(nested.map((n) => [n.summary.filePath, n.session]));
  const loadSession = (summary: SessionSummary): Promise<Session | null> => {
    const hit = preloaded.get(summary.filePath);
    return hit ? Promise.resolve(hit) : deps.loadSession(summary);
  };

  // `sessions` is the lossless CLI representation. The scalar remains for
  // direct API callers and the shipped one-selector contract.
  const explicitSelectors =
    opts.sessions !== undefined && opts.sessions.length > 0
      ? [...opts.sessions]
      : opts.session !== undefined
        ? [opts.session]
        : [];
  const allSummaries = [...sessions, ...nested.map((n) => n.summary)];
  const explicitByPath = new Map<string, RawContributor>();
  for (const selector of explicitSelectors) {
    const summary = await selectExplicitSession(allSummaries, selector);
    if (!summary) {
      return { error: `no session matched "${selector}"` };
    }
    if (explicitByPath.has(summary.filePath)) {
      continue;
    }
    const session = await loadSession(summary);
    if (!session) {
      return { error: `failed to load session "${summary.id}"` };
    }
    preloaded.set(summary.filePath, session);
    explicitByPath.set(summary.filePath, {
      summary,
      session,
      slice: computeSlice(session.turns, shas),
      // Explicitly-selected sessions are the user's own attribution claim — anchor-grade.
      basis: "anchor",
    });
  }

  if (explicitSelectors.length === 1) {
    return {
      contributors: [...explicitByPath.values()],
      excludedCount: 0,
      events: [],
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
      // SPEC-0045 R2 anti-wallpaper — a degraded (unparseable) file that only
      // overlaps the branch window, with no repo cwd match, is NOT proven ours;
      // admitting it to the anchor pool would fire `unreadable-session` on time
      // overlap alone (wallpaper). Unscopeable → excluded, documented (R4). A
      // degraded file WITH a repo cwd took the isBranchCandidate branch above.
      if (s.degraded) {
        continue;
      }
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
  for (const n of nested) {
    if (isBranchCandidate(n.summary, roots, commitMs)) {
      candidates.push({ summary: n.summary, pool: "repo" });
    } else if (overlapsBranchWindow(n.summary, commitMs) && !n.summary.degraded) {
      // SPEC-0045 R2 anti-wallpaper — same rule as the top-level pool: a degraded
      // nested candidate only joins the pools when repo-scoped (branch above).
      candidates.push({ summary: n.summary, pool: "anchor" });
    }
  }
  if (candidates.length === 0 && sidechains.length === 0 && explicitSelectors.length === 0) {
    return { error: NO_MATCH };
  }
  const selection = await selectContributors(candidates, shas, {
    branchSubjects: subjects,
    loadSession,
    currentWorktreeRoot: currentWorktreeRoot(deps.runGit, deps.cwd) ?? deps.cwd,
    runGit: deps.runGit,
  });
  if (explicitSelectors.length < 2) {
    return { ...selection, sidechains };
  }

  // Repeated flags are additive: auto attribution remains the conservative
  // baseline, while each named transcript is an explicit user claim. Replace
  // an auto copy with its explicit form instead of counting it twice. When the
  // auto copy carries recovered amend aliases, retain that richer slicing data
  // and only upgrade its basis.
  const contributorsByPath = new Map(selection.contributors.map((raw) => [raw.summary.filePath, raw]));
  for (const explicit of explicitByPath.values()) {
    const automatic = contributorsByPath.get(explicit.summary.filePath);
    contributorsByPath.set(explicit.summary.filePath, automatic ? { ...automatic, basis: "anchor" } : explicit);
  }
  const contributors = [...contributorsByPath.values()].sort(
    (a, b) =>
      (a.session.startedAt ?? 0) - (b.session.startedAt ?? 0) ||
      a.summary.id.localeCompare(b.summary.id) ||
      a.summary.filePath.localeCompare(b.summary.filePath),
  );

  // An auto-attribution drop for a transcript the user explicitly attached is
  // no longer a drop. Removing its event also keeps the legacy excluded count
  // and the typed confidence summary on the same source of truth.
  const explicitPaths = new Set(explicitByPath.keys());
  const events = selection.events.filter((event) => !explicitPaths.has(event.sessionId));
  const excludedCount = new Set(
    events
      .filter((event) => event.kind === "silenced-git-write" || event.kind === "unanchored-git-write")
      .map((event) => event.sessionId),
  ).size;
  return { contributors, excludedCount, events, sidechains };
}

/**
 * Slice → price → roll up → role each contributor into what the comment
 * renders (R2/R3). The sliced `ReceiptModel` is returned alongside the view —
 * SPEC-0027's artifact page renders it in full instead of discarding it.
 */
/**
 * SPEC-0044 B3 + M2 — per-session/subagent ConfidenceEvents raised in the cost
 * loop (like A3's emitter), so the explicit `pr --session` path — which flows
 * through the SAME loop — is covered without a separate site:
 *  - `dropped-transcript-records` (B3): a credited session or rolled-up subagent
 *    whose transcript had records skipped at parse time under-reports its cost.
 *  - `unreadable-subagent` (M2): a rolled-up subagent transcript that couldn't be
 *    read. This routes the long-standing legacy `SubagentRow.unreadable` floor
 *    (body.ts `totals.unreadableCount`) through the typed contract too, so the
 *    "single typed enumeration" claim holds. Both agree by construction (same
 *    `row.unreadable`); the legacy count still renders the note, the event floors
 *    — no double note, so output is byte-identical.
 *  - `partial-priced-coverage`: a credited contributor/subagent has a known `$`
 *    plus turns that could only contribute tokens. The exact excluded tokens
 *    render separately and the known-dollar total is visibly floored.
 */
export function pushSessionSubagentEvents(
  events: ConfidenceEvent[],
  raw: RawContributor,
  subagents: SubagentRow[],
  model: Pick<ReceiptModel, "unpricedTokens" | "unobservedCacheWriteTokens">,
): void {
  if ((raw.session.droppedRecords ?? 0) > 0) {
    events.push({ kind: "dropped-transcript-records", sessionId: raw.summary.filePath });
  }
  if ((model.unpricedTokens?.total ?? 0) > 0) {
    events.push({ kind: "partial-priced-coverage", sessionId: raw.summary.filePath });
  }
  if (model.unobservedCacheWriteTokens) {
    events.push({ kind: "unobserved-cache-write-tokens", sessionId: raw.summary.filePath });
  }
  for (const row of subagents) {
    if ((row.droppedRecords ?? 0) > 0) {
      events.push({ kind: "dropped-transcript-records", sessionId: row.filePath });
    }
    if (row.unreadable) {
      events.push({ kind: "unreadable-subagent", sessionId: row.filePath });
    }
    if ((row.unpricedTokens?.total ?? 0) > 0) {
      events.push({ kind: "partial-priced-coverage", sessionId: row.filePath });
    }
    if (row.unobservedCacheWriteTokens) {
      events.push({ kind: "unobserved-cache-write-tokens", sessionId: row.filePath });
    }
  }
}

async function buildContributorView(raw: RawContributor, deps: PrDeps, excludedChildren?: ReadonlySet<string>): Promise<{ view: ContributorView; model: ReceiptModel }> {
  const rendered = raw.slice.kind === "slice" ? sliceSessionForReceipt(raw.session, raw.slice) : raw.session;
  const model = await buildReceiptModel(rendered);
  const window: RollupWindow =
    raw.slice.kind === "full"
      ? { kind: "full" }
      : rendered.startedAt !== undefined && rendered.endedAt !== undefined
        ? { kind: "range", start: rendered.startedAt, end: rendered.endedAt }
        : { kind: "unknown" };
  const subagents = await deps.rollup(raw.summary.filePath, window, excludedChildren);
  const view: ContributorView = {
    role: deriveRole(raw.summary, raw.session, subagents.length > 0),
    sessionId: stemOf(raw.summary.filePath),
    slice: raw.slice,
    modelMix: model.modelMix,
    usd: model.totalUsd,
    tokens: model.totalTokens,
    ...(model.unpricedTokens ? { unpricedTokens: model.unpricedTokens } : {}),
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
  extras?: { notAttributable?: string[]; perCommitJson?: string; handoff?: HandoffSlipView; samosa?: boolean },
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

function countedTurns(raw: RawContributor): number {
  return raw.slice.kind === "slice" ? raw.slice.endTurn - raw.slice.startTurn + 1 : raw.session.totals.turnCount;
}

function countedToolCalls(raw: RawContributor): number {
  if (raw.slice.kind !== "slice") {
    return raw.session.totals.toolCallCount;
  }
  return raw.session.turns
    .slice(raw.slice.startTurn, raw.slice.endTurn + 1)
    .reduce((sum, turn) => sum + turn.toolCalls.length, 0);
}

/** `aireceipts pr [--post] [--session <id>] [--artifact]`. Returns structured telemetry-safe outcome facts. */
export async function runPrDetailed(opts: PrOptions, deps: PrDeps = defaultPrDeps()): Promise<PrRunResult> {
  // R4 (SPEC-0027): the artifact exists to be linked — reject before rendering.
  if (opts.artifact && !opts.post) {
    deps.err("--artifact requires --post");
    return prResult({ code: 1, result: "invalid_args" });
  }
  // SPEC-0035 R5: the share hint targets the artifact link — same shape as the guard above.
  if (opts.share && !opts.artifact) {
    deps.err("--share requires --artifact");
    return prResult({ code: 1, result: "invalid_args" });
  }

  // Branch SHAs + commit dates: SHAs anchor/slice (R1/R1e), commit dates filter candidates (R1d).
  const branchInfo = branchCommits(deps.runGit, deps.cwd);
  const { shas, commitMs } = branchInfo;

  const resolved = await resolveContributors(opts, deps, shas, commitMs, branchInfo.subjects);
  if ("error" in resolved) {
    deps.err(resolved.error);
    return prResult({ code: 1, result: "no_data" });
  }

  // SPEC-0024 R3 ordering: base views first (their rollups define what is
  // already counted), then promotion of uncovered anchored sidechains, then
  // one chronological sort across both (startedAt, then id — SPEC-0023 order).
  const entries: { view: ContributorView; model: ReceiptModel; startedAt: number; id: string; raw: RawContributor }[] = [];
  const covered = new Set<string>();
  // SPEC-0038 R3 dedup — nested sessions credited as contributors must not
  // ALSO appear inside their parent's SUBAGENTS rollup (filePath key).
  //
  // SPEC-0044 B5 — that alone only covers ONE level: a promoted contributor
  // (say A, a subagent of P that made its own branch commit) owns its ENTIRE
  // subtree, not just its own row. `discoverChildFiles` walks recursively, so
  // P's rollup call flattens A's descendants (e.g. grandchild B) in too —
  // B then prices once under P's rollup AND once under A's own rollup.
  // Fixed by computing, per contributor being rolled up, an exclusion set
  // that also carves out any OTHER promoted contributor's subtree when that
  // promoted contributor is nested underneath the one currently rolling up
  // (this generalizes: if a further-promoted grandchild ever existed, its
  // territory would be carved out of its promoted parent too, not just the
  // top ancestor — though `nestedCandidates` currently only promotes direct
  // children of top-level sessions, so chains deeper than P→A→B don't arise
  // in practice; the subtree logic is correct regardless). The promoted
  // contributor itself still rolls up its own direct subtree normally:
  // `exclusionsFor(X)` never subtracts X's own descendants.
  // Kept as the ONE dedup site; `rollupChildren`'s exact-file exclusion check
  // is unchanged — callers just hand it a subtree-aware set now.
  const promotedChildPaths = resolved.contributors
    .filter((r) => isChildPath(r.summary.filePath))
    .map((r) => r.summary.filePath);
  const promotedDescendants = new Map<string, string[]>();
  for (const promotedPath of promotedChildPaths) {
    promotedDescendants.set(promotedPath, await discoverChildFiles(promotedPath));
  }
  function exclusionsFor(contributorFilePath: string): ReadonlySet<string> {
    const excluded = new Set<string>(promotedChildPaths);
    for (const promotedPath of promotedChildPaths) {
      if (promotedPath === contributorFilePath || !isDescendantOfContributor(promotedPath, contributorFilePath)) {
        continue;
      }
      for (const descendant of promotedDescendants.get(promotedPath) ?? []) {
        excluded.add(descendant);
      }
    }
    return excluded;
  }
  // SPEC-0044 A3 — collected across BOTH contributor loops below (main +
  // promoted sidechains) and folded into `allEvents` before any
  // `summarizeConfidence` call sees it.
  const costEvents: ConfidenceEvent[] = [];
  for (const raw of resolved.contributors) {
    const { view, model } = await buildContributorView(raw, deps, exclusionsFor(raw.summary.filePath));
    covered.add(raw.summary.filePath);
    for (const row of view.subagents) {
      covered.add(row.filePath);
    }
    if (model.costLowerBoundCacheTier) {
      costEvents.push({ kind: "cost-lower-bound-cache-tier", sessionId: raw.summary.filePath });
    }
    pushSessionSubagentEvents(costEvents, raw, view.subagents, model);
    entries.push({ view, model, startedAt: raw.session.startedAt ?? 0, id: raw.summary.id, raw });
  }
  const { promoted, events: promoteEvents } = await promoteOrphanSidechains(resolved.sidechains, shas, covered, deps.loadSession);
  for (const raw of promoted) {
    const { view, model } = await buildContributorView(raw, deps, exclusionsFor(raw.summary.filePath));
    if (model.costLowerBoundCacheTier) {
      costEvents.push({ kind: "cost-lower-bound-cache-tier", sessionId: raw.summary.filePath });
    }
    pushSessionSubagentEvents(costEvents, raw, view.subagents, model);
    entries.push({ view, model, startedAt: raw.session.startedAt ?? 0, id: raw.summary.id, raw });
  }
  const allEvents = [...resolved.events, ...promoteEvents, ...costEvents];
  if (entries.length === 0) {
    // SPEC-0044 A1 (S2 finding 1): if the ONLY thing that touched the branch was
    // an unattributable anchor-pool session, don't claim "no match" — say so.
    const summary = summarizeConfidence(allEvents);
    if (summary.unattributableAnchorPool > 0) {
      deps.err(
        `${summary.unattributableAnchorPool} session(s) touched this branch but couldn't be attributed precisely (no sliceable commit); nothing to receipt. See docs/trust.md.`,
      );
    } else {
      deps.err(NO_MATCH);
    }
    return prResult({ code: 1, result: "no_data" });
  }
  entries.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  // Round 2: the fence renders authors first, helpers grouped after — the
  // details section and the artifact page must show the SAME order, so the
  // size-cap's drop-from-END sheds helpers before authors.
  const fenceOrdered = [...entries.filter((e) => e.view.basis !== "helper"), ...entries.filter((e) => e.view.basis === "helper")];
  const views = entries.map((e) => e.view);
  const bodyInput: PrBodyInput = { contributors: views, excludedCount: resolved.excludedCount, confidence: summarizeConfidence(allEvents) };
  const receipt: PrReceiptTelemetry = {
    models: entries.map((e) => e.model),
    turnCount: entries.reduce((sum, e) => sum + countedTurns(e.raw), 0),
    toolCallCount: entries.reduce((sum, e) => sum + countedToolCalls(e.raw), 0),
  };
  // SPEC-0059 R5 — the handoff slip's raw facts, from the same sliced models
  // the details section prints. Built here so the artifact (R6) and the
  // comment section share one aggregation.
  const handoffData: HandoffSectionData = {
    wasteLines: fenceOrdered.flatMap((e) => e.model.wasteLines),
    sessionCount: entries.length,
    turnCount: receipt.turnCount,
  };

  // SPEC-0027 R3: push the artifact BEFORE rendering the one final body, so
  // the printed and posted bodies are identical and the link only renders
  // after a confirmed push. A failed publish still posts (additive-only).
  let artifactFailed = false;
  let link: { fileName: string; url: string; ownerRepo: string } | null = null;
  let artifactResult: StepResultValue = "skipped";
  if (opts.artifact) {
    // SPEC-0031 R3a — per-commit tables for sliced sessions; everything else
    // (helpers, full fallbacks) lands in the labeled bucket. The slicer's own
    // refusal to cut a session is honored here: no table where no slice.
    const sessions: ArtifactSession[] = [];
    const islandData: { session: string; rows: unknown[] }[] = [];
    const notAttributable: string[] = [];
    for (const e of fenceOrdered) {
      const label = detailLabel(e.view, e.model);
      const segments = segmentSlice(
        e.raw.slice,
        anchorEvents(e.raw.session.turns, branchInfo.shas, e.raw.anchorAliases),
        branchInfo,
      );
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
      // SPEC-0059 R6 — same slip, same builder; the artifact always carries its
      // full receipts, so its handoff section ignores --no-details too.
      handoff: buildHandoffSlip(handoffData, bodyInput) ?? undefined,
      // SPEC-0070 R3 — opt-in footer tip link, off by default.
      samosa: opts.samosa === true,
    });
    artifactFailed = link === null;
    artifactResult = link === null ? "failed" : "success";
  }
  // SPEC-0026 R5 (round 2) — per-session full receipts, collapsed, unless
  // --no-details. The label is the stat line: everything the fence dropped
  // (id, slice reason) plus the session's anatomy, in one place.
  const details = opts.details === false
    ? undefined
    : fenceOrdered.map((e) => ({
        label: detailHeading(e.view),
        row: detailRow(e.view, e.model),
        text: renderReceipt(e.model, { color: false }),
        // SPEC-0060 R3 — the per-child breakdown the fence no longer draws.
        subagents: e.view.subagents.length > 0 ? subagentDetailsTable(e.view.subagents) : undefined,
      }));
  // SPEC-0059 R5 — the comment's handoff section is a sibling of the details
  // section and shares its --no-details gate; R8's boolean is the assembler's
  // own decision, not a scan of the body.
  const extras: PrBodyExtras = {
    // Project to the declared `{ fileName, url }` — `link` also carries a runtime
    // `ownerRepo` (used for the share-hint check below, not by the renderer). Storing it
    // in the payload would smuggle an unknown field past `PrBodyExtras.artifactLink` that
    // SPEC-0066's strict CI validator rejects (Codex review).
    artifactLink: link ? { fileName: link.fileName, url: link.url } : undefined,
    details,
    handoff: opts.details === false ? undefined : handoffData,
    // SPEC-0070 R2/R4 — opt-in comment tip link. OMITTED (undefined, like
    // artifactLink/handoff above) when off, never `false`: a default store=ref
    // payload then carries no new key, stays byte-identical to a pre-feature ref,
    // and is accepted by an older strict consumer (Codex work review). Only a
    // `--samosa` ref grows the field, and it re-renders the link CI-side.
    samosa: opts.samosa === true ? true : undefined,
  };
  const { body, handoffSectionIncluded } = renderPrBodyDetailed(bodyInput, extras);

  // SPEC-0065 R1 — `store=ref`: in addition to (never instead of) the comment
  // path below, which stays the unconditional default, write the exact
  // renderer input as a schema-versioned payload to `refs/aireceipts/<slug>`
  // via pure git plumbing. Precedence: flag > `AIRECEIPTS_STORE` env >
  // default `"comment"`; R3's committed-settings layer is out of scope here.
  const store = opts.store ?? (process.env.AIRECEIPTS_STORE === "ref" ? "ref" : undefined) ?? "comment";
  if (store === "ref") {
    const branch = currentBranchName(deps.runGit, deps.cwd);
    if (!branch) {
      deps.err("store=ref skipped: could not resolve current branch");
    } else {
      const payload = buildPrReceiptPayload(bodyInput, extras);
      const json = serializePrReceipt(payload);
      const endedAtMs = canonicalEndedAtMs(receipt.models);
      const slug = receiptRefSlug(branch);
      const outcome = writeReceiptRef(slug, branch, json, endedAtMs, deps.cwd);
      if (outcome.ok) {
        deps.err(`wrote receipt ref ${outcome.ref} (${outcome.commit})`);
        // SPEC-0065 R2 — best-effort push of the ref itself, for the pre-push
        // hook's `--push-ref` call. Never throws and never affects `code`: a
        // push failure (no remote, no push rights, offline) prints one line
        // and the branch push the hook is running inside of proceeds.
        if (opts.pushRef) {
          const pushed = pushReceiptRef(slug, "origin", deps.cwd);
          if (!pushed) {
            deps.err(`store=ref: push of ${outcome.ref} to origin failed (best-effort, continuing)`);
          }
        }
      } else {
        deps.err(`store=ref failed: ${outcome.reason}`);
      }
    }
  }

  // R3 (SPEC-0019): render before the comment upsert, unconditionally.
  deps.out(body);

  if (!opts.post) {
    return prResult({
      code: 0,
      bodyRendered: true,
      contributorCount: entries.length,
      receipt,
      artifactResult,
      handoffSectionIncluded,
      result: "success",
    });
  }

  const comment = upsertPrComment(body, deps.runGh);
  if (!comment.ok) {
    deps.err(comment.error);
    return prResult({
      code: 1,
      bodyRendered: true,
      contributorCount: entries.length,
      receipt,
      commentResult: "failed",
      artifactResult,
      handoffSectionIncluded,
      result: comment.missing ? "external_missing" : "external_failed",
    });
  }
  deps.err(`posted receipt (${comment.action}) to PR #${comment.prNumber}`);
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
  let shareResult: StepResultValue = "skipped";
  if (opts.share && link !== null) {
    if (link.fileName !== artifactFileName(comment.prNumber) || link.ownerRepo !== comment.ownerRepo) {
      deps.err(`share hint skipped: artifact ${link.ownerRepo}/${link.fileName} does not match comment PR ${comment.ownerRepo}#${comment.prNumber}`);
    } else {
      const visibility = repoVisibility(link.ownerRepo, deps.runGh);
      if (visibility === "public") {
        for (const line of buildShareLines(link.url)) {
          deps.err(line);
        }
        shareResult = "success";
      } else if (visibility === "private") {
        deps.err("share: skipped — repo is private; the viewer cannot render this for readers (works automatically once the repo is public)");
      } else {
        deps.err("share: skipped — could not verify repo visibility");
      }
    }
  }
  return prResult({
    code: artifactFailed ? 1 : 0,
    bodyRendered: true,
    contributorCount: entries.length,
    receipt,
    commentResult: "success",
    artifactResult,
    shareResult,
    handoffSectionIncluded,
    result: artifactFailed ? "external_failed" : "success",
  });
}

/** `aireceipts pr [--post] [--session <id>]`. Returns the process exit code. */
export async function runPr(opts: PrOptions, deps: PrDeps = defaultPrDeps()): Promise<number> {
  return (await runPrDetailed(opts, deps)).code;
}
