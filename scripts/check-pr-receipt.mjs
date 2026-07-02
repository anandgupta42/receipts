#!/usr/bin/env node
// SPEC-0019 R5 — CI presence check for the aireceipts PR receipt comment. Pure
// verdict (`hasReceiptComment`) plus a thin CLI. This NEVER fails the build:
// external contributors have no local sessions and must not be blocked. The
// workflow feeds it `gh api` comment JSON and emits a neutral `::notice` when
// the receipt is missing.
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

function main(argv) {
  const file = argv[2];
  let json = "[]";
  try {
    json = file && file !== "-" ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
  } catch {
    json = "[]";
  }
  process.stdout.write(hasReceiptComment(json) ? "found\n" : "missing\n");
  return 0; // never fail — presence is advisory (R5)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}
