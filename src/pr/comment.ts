// SPEC-0019 R2 — post the receipt to the PR via `gh`, as a concrete upsert:
// resolve the PR number, list its issue comments, find the one whose body starts
// with the dogfood marker, and PATCH it by id (or create if absent). One receipt
// comment per PR, always current — `gh pr comment --edit-last` is deliberately
// NOT used (it can target the wrong comment). The `gh` runner is injected so
// tests never shell out.
import type { CommandRunner } from "./git.js";
import { DOGFOOD_MARKER } from "./body.js";

export type UpsertOutcome =
  | { ok: true; action: "created" | "updated"; prNumber: number; commentId?: number }
  | { ok: false; error: string; missing?: boolean };

interface RawComment {
  id?: number;
  body?: string;
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
  const view = run("gh", ["pr", "view", "--json", "number"]);
  if (view.missing) {
    return { ok: false, error: "gh not found — copy the receipt above into your PR", missing: true };
  }
  if (view.code !== 0) {
    return { ok: false, error: `no PR for this branch (gh pr view failed): ${view.stderr.trim()}` };
  }
  let prNumber: number;
  try {
    prNumber = Number((JSON.parse(view.stdout) as { number?: unknown }).number);
  } catch {
    return { ok: false, error: "could not parse PR number from gh pr view" };
  }
  if (!Number.isInteger(prNumber)) {
    return { ok: false, error: "gh pr view returned no PR number" };
  }

  const list = run("gh", ["api", "--paginate", `repos/{owner}/{repo}/issues/${prNumber}/comments`]);
  if (list.code !== 0) {
    return { ok: false, error: `could not list PR comments: ${list.stderr.trim()}` };
  }
  const existingId = findMarkerCommentId(list.stdout);
  const payload = JSON.stringify({ body });

  if (existingId !== undefined) {
    const patch = run("gh", ["api", `repos/{owner}/{repo}/issues/comments/${existingId}`, "-X", "PATCH", "--input", "-"], {
      stdin: payload,
    });
    if (patch.code !== 0) {
      return { ok: false, error: `could not update PR comment: ${patch.stderr.trim()}` };
    }
    return { ok: true, action: "updated", prNumber, commentId: existingId };
  }

  const create = run("gh", ["api", `repos/{owner}/{repo}/issues/${prNumber}/comments`, "-X", "POST", "--input", "-"], {
    stdin: payload,
  });
  if (create.code !== 0) {
    return { ok: false, error: `could not create PR comment: ${create.stderr.trim()}` };
  }
  return { ok: true, action: "created", prNumber };
}
