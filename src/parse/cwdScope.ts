// SPEC-0075 R1 — shared path matching and Claude Code project-directory
// encoding for cwd-scoped statusline discovery. These are string operations,
// not filesystem resolution: the transcript's recorded cwd is the authority.
// `.`/`..` resolve lexically to wherever the requested path actually points
// (defense for hand-typed --cwd values; real surfaces pass resolved paths),
// and a root — `/`, a drive `x:`, a UNC `//server` prefix — matches its own
// subtree, per the whole-segment ancestor rule.

/**
 * Normalize the cross-platform spelling differences relevant to cwd
 * attribution, resolving `.`/`..` segments lexically so a traversal like
 * `/repo/../other` can never match `/repo`'s sessions (I2/I3 — the match must
 * hold for the path actually requested, not a spelling of a different one).
 * A UNC-style leading `//` is preserved; duplicate interior slashes collapse.
 */
export function normalizeCwd(cwd: string): string {
  const withForwardSlashes = cwd.replace(/\\/g, "/");
  // A `X:` drive prefix is a root boundary: it folds to lowercase and can
  // never be popped by `..` (`C:/../Other` resolves to `c:/Other`, not a
  // relative `Other` that would match an unrelated session).
  const driveMatch = /^([A-Za-z]):(?=\/|$)/.exec(withForwardSlashes);
  const drive = driveMatch ? `${driveMatch[1].toLowerCase()}:` : "";
  const rest = drive ? withForwardSlashes.slice(2) : withForwardSlashes;
  const isAbsolute = drive !== "" || rest.startsWith("/");
  const isUnc = drive === "" && rest.startsWith("//");

  const resolved: string[] = [];
  for (const segment of rest.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      // Lexical parent: drop the last real segment; at an absolute root,
      // `..` stays at the root; for relative paths it is preserved so the
      // (unresolvable) prefix still never equals an unrelated absolute path.
      if (resolved.length > 0 && resolved[resolved.length - 1] !== "..") {
        resolved.pop();
      } else if (!isAbsolute) {
        resolved.push("..");
      }
      continue;
    }
    resolved.push(segment);
  }

  if (drive) {
    return resolved.length > 0 ? `${drive}/${resolved.join("/")}` : drive;
  }
  const prefix = isUnc ? "//" : isAbsolute ? "/" : "";
  const joined = prefix + resolved.join("/");
  return joined === "" ? "" : joined === "//" ? "/" : joined;
}

/** True when the session cwd is the requested cwd or one of its whole-segment ancestors. */
export function cwdMatches(sessionCwd: string, requestedCwd: string): boolean {
  const session = normalizeCwd(sessionCwd);
  const requested = normalizeCwd(requestedCwd);
  if (session === requested) {
    return true;
  }
  if (session === "/") {
    return requested.startsWith("/");
  }
  return session !== "" && requested.startsWith(`${session}/`);
}

/**
 * SPEC-0075 R1 — the attribution rule scoped discovery actually applies.
 * `cwdMatches` plus one policy guard: a session recorded at the user's home
 * directory or above (an agent launched from `~` or `/`) never ancestor-matches
 * — it matches its exact path only. Without this, one home-launched session is
 * an ancestor of every path on the machine and permanently shadows the
 * no-session placeholder (observed on real data: a `~`-launched Codex session
 * rendered for a path no agent ever touched). `homeDir` is a parameter so the
 * rule stays a pure string decision.
 */
export function cwdMatchesForAttribution(sessionCwd: string, requestedCwd: string, homeDir: string): boolean {
  const session = normalizeCwd(sessionCwd);
  const requested = normalizeCwd(requestedCwd);
  if (session === requested) {
    return true;
  }
  if (!cwdMatches(sessionCwd, requestedCwd)) {
    return false;
  }
  const home = normalizeCwd(homeDir);
  const homeOrAbove = home !== "" && (session === home || home.startsWith(`${session}/`) || session === "/");
  return !homeOrAbove;
}

/** Claude Code replaces every non-ASCII-alphanumeric cwd character with `-`. */
export function encodeClaudeProjectCwd(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

/**
 * Encoded Claude Code project-directory names for the requested cwd and each
 * path ancestor. Ancestors are computed before encoding because encoding is
 * lossy (`/my-repo` and `/my/repo` collide), and by slicing the normalized
 * string (not rebuilding from segments) so a UNC `//server/share` keeps both
 * leading slashes — its encoded name is `--server-share`, never `-server-share`.
 */
export function claudeProjectDirectoryNames(requestedCwd: string): string[] {
  const cwd = normalizeCwd(requestedCwd);
  if (!cwd) {
    return [];
  }

  const ancestors: string[] = [];
  if (cwd.startsWith("/") && !cwd.startsWith("//")) {
    ancestors.push("/");
  }
  const start = cwd.startsWith("//") ? 2 : cwd.startsWith("/") ? 1 : 0;
  for (let i = start; i < cwd.length; i++) {
    if (cwd[i] === "/") {
      ancestors.push(cwd.slice(0, i));
    }
  }
  ancestors.push(cwd);

  return [...new Set(ancestors.filter(Boolean).map(encodeClaudeProjectCwd))];
}
