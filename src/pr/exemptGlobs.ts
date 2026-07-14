// SPEC-0036 R2 amendment (maintainer-directed, 2026-07-13) — enforcement
// carve-out for branches authored without a capturable agent session (release
// checkouts, CI chores). This is the npm-native twin of the logic in
// scripts/check-pr-receipt.mjs; a parity test (test/pr/exempt-globs.test.ts)
// keeps the two implementations agreeing. If you change one, change both.

/**
 * Anchored shell-style glob match (`*` wildcards only). Two-pointer scan with
 * a single backtrack point, so worst case is O(text * glob): no RegExp, no
 * catastrophic backtracking on pathological patterns like `release/*a*a*a*Z`.
 */
export function globMatch(text: string, glob: string): boolean {
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
 * (e.g. `release/* chore/release-*`). Exempt branches stay notice-only under
 * same-repo enforcement. Keep patterns narrow: feature work must not be able
 * to slip through.
 */
export function isExemptRef(headRef: string, exemptGlobs: string): boolean {
  if (!headRef || !exemptGlobs) {
    return false;
  }
  return exemptGlobs
    .split(/\s+/)
    .filter(Boolean)
    .some((glob) => globMatch(headRef, glob));
}
