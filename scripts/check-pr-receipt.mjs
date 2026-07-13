#!/usr/bin/env node
// SPEC-0019 R5 — CI presence check for the aireceipts PR receipt comment. Pure
// verdicts (`hasReceiptComment`, `receiptCheckVerdict`) plus a thin CLI. The
// script itself never exits non-zero; the workflow decides whether maintainers
// opted into blocking same-repo PRs or keeping all misses advisory.
import { readFileSync } from "node:fs";

// Mirrors DOGFOOD_MARKER in src/pr/body.ts — kept in parity by a unit test
// (test/pr/marker-parity.test.ts). If you change one, change both.
export const DOGFOOD_MARKER = "<!-- aireceipts-dogfood -->";

/** True iff the GitHub issue-comments JSON contains an aireceipts receipt comment. */
export function hasReceiptComment(commentsJson) {
  let parsed;
  try {
    parsed = JSON.parse(commentsJson);
  } catch {
    return false;
  }
  if (!Array.isArray(parsed)) {
    return false;
  }
  return parsed.some((c) => c && typeof c.body === "string" && c.body.startsWith(DOGFOOD_MARKER));
}

/**
 * Anchored shell-style glob match (`*` wildcards only). Two-pointer scan with
 * single backtrack-point, so worst case is O(text * glob): no RegExp, no
 * catastrophic backtracking on pathological patterns like `release/*a*a*a*Z`
 * (Codex review, 2026-07-13).
 */
function globMatch(text, glob) {
  let t = 0;
  let g = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (g < glob.length && glob[g] === "*") {
      star = g;
      mark = t;
      g += 1;
    } else if (g < glob.length && glob[g] === text[t]) {
      t += 1;
      g += 1;
    } else if (star !== -1) {
      mark += 1;
      t = mark;
      g = star + 1;
    } else {
      return false;
    }
  }
  while (g < glob.length && glob[g] === "*") {
    g += 1;
  }
  return g === glob.length;
}

/**
 * True iff `headRef` matches one of the space-separated shell-style globs
 * (`*` wildcards only, e.g. `release/* chore/release-*`). Exempt branches are
 * authored without a capturable agent session (release checkouts, CI chores),
 * so enforcement must not block them. Keep patterns narrow: feature work must
 * not be able to slip through.
 */
export function isExemptRef(headRef, exemptGlobs) {
  if (!headRef || !exemptGlobs) {
    return false;
  }
  return exemptGlobs
    .split(/\s+/)
    .filter(Boolean)
    .some((glob) => globMatch(headRef, glob));
}

/**
 * Returns a workflow-friendly verdict.
 *
 * `found`: a marked aireceipts comment is present.
 * `missing-required`: same-repo PR missing a receipt and enforcement is enabled.
 * `missing-notice`: missing receipt in the default/advisory mode, on a fork PR,
 *   or on an exempt branch (`exemptGlobs` matched `headRef`).
 */
export function receiptCheckVerdict(
  commentsJson,
  { headRepo = "", baseRepo = "", requireSameRepo = false, headRef = "", exemptGlobs = "" } = {},
) {
  if (hasReceiptComment(commentsJson)) {
    return "found";
  }
  if (requireSameRepo && headRepo && baseRepo && headRepo === baseRepo && !isExemptRef(headRef, exemptGlobs)) {
    return "missing-required";
  }
  return "missing-notice";
}

function parseArgs(argv) {
  let file = "";
  let headRepo = "";
  let baseRepo = "";
  let requireSameRepo = false;
  let headRef = "";
  let exemptGlobs = "";
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--head-repo") {
      headRepo = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg === "--base-repo") {
      baseRepo = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg === "--require-same-repo") {
      requireSameRepo = true;
      continue;
    }
    if (arg === "--head-ref") {
      headRef = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg === "--exempt-globs") {
      exemptGlobs = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (!file) {
      file = arg;
    }
  }
  return { file, headRepo, baseRepo, requireSameRepo, headRef, exemptGlobs };
}

function main(argv) {
  const { file, headRepo, baseRepo, requireSameRepo, headRef, exemptGlobs } = parseArgs(argv);
  let json = "[]";
  try {
    json = file && file !== "-" ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
  } catch {
    json = "[]";
  }
  if (headRepo || baseRepo) {
    process.stdout.write(`${receiptCheckVerdict(json, { headRepo, baseRepo, requireSameRepo, headRef, exemptGlobs })}\n`);
    return 0;
  }
  process.stdout.write(hasReceiptComment(json) ? "found\n" : "missing\n");
  return 0; // never fail; callers enforce the returned verdict.
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}
