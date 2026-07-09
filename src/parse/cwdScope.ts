// SPEC-0075 R1 — shared path matching and Claude Code project-directory
// encoding for cwd-scoped statusline discovery. These are string operations,
// not filesystem resolution: the transcript's recorded cwd is the authority.

/**
 * Normalize the cross-platform spelling differences relevant to cwd
 * attribution, resolving `.`/`..` segments lexically so a traversal like
 * `/repo/../other` can never match `/repo`'s sessions (I2/I3 — the match must
 * hold for the path actually requested, not a spelling of a different one).
 * A UNC-style leading `//` is preserved; duplicate interior slashes collapse.
 */
export function normalizeCwd(cwd: string): string {
  const withForwardSlashes = cwd.replace(/\\/g, "/");
  const isAbsolute = withForwardSlashes.startsWith("/");
  const isUnc = withForwardSlashes.startsWith("//");

  const resolved: string[] = [];
  for (const segment of withForwardSlashes.split("/")) {
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

  const prefix = isUnc ? "//" : isAbsolute ? "/" : "";
  const joined = prefix + resolved.join("/");
  const normalized = joined === "" ? "" : joined === "//" ? "/" : joined;
  return normalized.replace(/^([A-Z]):(?=\/|$)/, (_, drive: string) => `${drive.toLowerCase()}:`);
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
