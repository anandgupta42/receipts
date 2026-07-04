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
 * Returns a workflow-friendly verdict.
 *
 * `found`: a marked aireceipts comment is present.
 * `missing-required`: same-repo PR missing a receipt and enforcement is enabled.
 * `missing-notice`: missing receipt in the default/advisory mode, or on a fork PR.
 */
export function receiptCheckVerdict(commentsJson, { headRepo = "", baseRepo = "", requireSameRepo = false } = {}) {
  if (hasReceiptComment(commentsJson)) {
    return "found";
  }
  if (requireSameRepo && headRepo && baseRepo && headRepo === baseRepo) {
    return "missing-required";
  }
  return "missing-notice";
}

function parseArgs(argv) {
  let file = "";
  let headRepo = "";
  let baseRepo = "";
  let requireSameRepo = false;
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
    if (!file) {
      file = arg;
    }
  }
  return { file, headRepo, baseRepo, requireSameRepo };
}

function main(argv) {
  const { file, headRepo, baseRepo, requireSameRepo } = parseArgs(argv);
  let json = "[]";
  try {
    json = file && file !== "-" ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
  } catch {
    json = "[]";
  }
  if (headRepo || baseRepo) {
    process.stdout.write(`${receiptCheckVerdict(json, { headRepo, baseRepo, requireSameRepo })}\n`);
    return 0;
  }
  process.stdout.write(hasReceiptComment(json) ? "found\n" : "missing\n");
  return 0; // never fail; callers enforce the returned verdict.
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}
