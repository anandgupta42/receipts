// SPEC-0019 R2 — post the receipt to the PR via `gh`, as a concrete upsert:
// resolve the PR number, list its issue comments, find the one whose body starts
// with the dogfood marker, and PATCH it by id (or create if absent). One receipt
// comment per PR, always current — `gh pr comment --edit-last` is deliberately
// NOT used (it can target the wrong comment). The `gh` runner is injected so
// tests never shell out.
import type { CommandRunner } from "./git.js";
import { DOGFOOD_MARKER } from "./body.js";

export type UpsertOutcome =
  | { ok: true; action: "created" | "updated"; prNumber: number; ownerRepo: string; commentId?: number; htmlUrl?: string }
  | { ok: false; error: string; missing?: boolean };

/** SPEC-0027 R3 — the one base-repo resolution the publish URL and blob URL both derive from. */
export type PrResolution = { ok: true; prNumber: number; ownerRepo: string } | { ok: false; error: string; missing?: boolean };

/**
 * Resolve the current branch's PR number and base `owner/repo` from a single
 * `gh pr view` call. The PR's own URL names the base repository (a fork's PR
 * URL points at the upstream repo), so the artifact push target and the
 * comment's blob link can never disagree (R3).
 */
export function resolvePr(run: CommandRunner): PrResolution {
  const view = run("gh", ["pr", "view", "--json", "number,url"]);
  if (view.missing) {
    return { ok: false, error: "gh not found — copy the receipt above into your PR", missing: true };
  }
  if (view.code !== 0) {
    return { ok: false, error: `no PR for this branch (gh pr view failed): ${view.stderr.trim()}` };
  }
  let prNumber: number;
  let url: string;
  try {
    const parsed = JSON.parse(view.stdout) as { number?: unknown; url?: unknown };
    prNumber = Number(parsed.number);
    url = String(parsed.url ?? "");
  } catch {
    return { ok: false, error: "could not parse gh pr view output" };
  }
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+$/.exec(url);
  if (!Number.isInteger(prNumber) || !m) {
    return { ok: false, error: "gh pr view returned no PR number/url" };
  }
  return { ok: true, prNumber, ownerRepo: m[1] };
}

/** SPEC-0035 R5 (PR #87 review): what GitHub reports about the base repo's visibility. */
export type RepoVisibility = "private" | "public" | "unknown";

/**
 * SPEC-0035 R5 (visibility guard, PR #87 review, tightened per its Codex
 * round): the share hint prints intent URLs only on a POSITIVE public
 * answer. `gh pr view --json` exposes no repo visibility field, so this is
 * the one cheapest equivalent call — run only on the `--share` path, after
 * both the push and the upsert have succeeded. An errored or unparseable
 * check is "unknown", which the caller skips neutrally: never a broken
 * private link, never a public repo mislabeled private.
 */
export function repoVisibility(ownerRepo: string, run: CommandRunner): RepoVisibility {
  const res = run("gh", ["api", `repos/${ownerRepo}`, "--jq", ".private"]);
  if (res.code !== 0) {
    return "unknown";
  }
  const out = res.stdout.trim();
  return out === "true" ? "private" : out === "false" ? "public" : "unknown";
}

interface RawComment {
  id?: number;
  body?: string;
}

/** Escape a string for literal use inside a `RegExp` (ownerRepo carries `/`, and may carry `.`/`-`). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * SPEC-0077 R5 — the `html_url` GitHub returns for the created/updated comment
 * (the sticky-comment permalink the card `--link` caption surfaces). Never
 * fetched separately: it rides the create/update response the `--post` already
 * made. Validated against the EXPECTED sticky-comment permalink shape for THIS
 * `owner/repo` and PR number — `https://github.com/<owner>/<repo>/pull/<n>#issuecomment-<id>`
 * — so an unexpected or wrong-repo `html_url` never lands in the caption; a
 * mismatch (or an unparseable/absent value) falls back to linkless.
 */
function parseCommentHtmlUrl(json: string, ownerRepo: string, prNumber: number): string | undefined {
  try {
    const parsed = JSON.parse(json) as { html_url?: unknown };
    if (typeof parsed.html_url !== "string") {
      return undefined;
    }
    const expected = new RegExp(`^https://github\\.com/${escapeRegExp(ownerRepo)}/pull/${prNumber}#issuecomment-\\d+$`);
    return expected.test(parsed.html_url) ? parsed.html_url : undefined;
  } catch {
    return undefined;
  }
}

/** Find the existing aireceipts comment id, if any (body starts with the marker). */
function findMarkerCommentId(json: string): number | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    return undefined;
  }
  for (const c of parsed as RawComment[]) {
    if (typeof c.body === "string" && c.body.startsWith(DOGFOOD_MARKER) && typeof c.id === "number") {
      return c.id;
    }
  }
  return undefined;
}

/**
 * Execute the R2 upsert. Returns a discriminated outcome — the caller (which has
 * already written the body to stdout, R3) turns a failure into a one-line stderr
 * diagnostic and exit 1. `gh` missing is surfaced explicitly so the caller can
 * add the "copy the receipt above" hint.
 */
export function upsertPrComment(body: string, run: CommandRunner): UpsertOutcome {
  // SPEC-0035 S6 (Codex round): resolve number AND base owner/repo from the
  // one `gh pr view` call (via resolvePr, same as the artifact path) and
  // address every endpoint at that explicit base repo — never the
  // `{owner}/{repo}` git-context placeholders, which could name a different
  // repo than the PR the number came from.
  const pr = resolvePr(run);
  if (!pr.ok) {
    return pr;
  }
  const { prNumber, ownerRepo } = pr;

  const list = run("gh", ["api", "--paginate", `repos/${ownerRepo}/issues/${prNumber}/comments`]);
  if (list.code !== 0) {
    return { ok: false, error: `could not list PR comments: ${list.stderr.trim()}` };
  }
  const existingId = findMarkerCommentId(list.stdout);
  const payload = JSON.stringify({ body });

  if (existingId !== undefined) {
    const patch = run("gh", ["api", `repos/${ownerRepo}/issues/comments/${existingId}`, "-X", "PATCH", "--input", "-"], {
      stdin: payload,
    });
    if (patch.code !== 0) {
      return { ok: false, error: `could not update PR comment: ${patch.stderr.trim()}` };
    }
    return { ok: true, action: "updated", prNumber, ownerRepo, commentId: existingId, htmlUrl: parseCommentHtmlUrl(patch.stdout, ownerRepo, prNumber) };
  }

  const create = run("gh", ["api", `repos/${ownerRepo}/issues/${prNumber}/comments`, "-X", "POST", "--input", "-"], {
    stdin: payload,
  });
  if (create.code !== 0) {
    return { ok: false, error: `could not create PR comment: ${create.stderr.trim()}` };
  }
  return { ok: true, action: "created", prNumber, ownerRepo, htmlUrl: parseCommentHtmlUrl(create.stdout, ownerRepo, prNumber) };
}
