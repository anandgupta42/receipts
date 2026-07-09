// SPEC-0075 R1 — shared path matching and Claude Code project-directory
// encoding for cwd-scoped statusline discovery. These are string operations,
// not filesystem resolution: the transcript's recorded cwd is the authority.

/** Normalize only the cross-platform spelling differences relevant to cwd attribution. */
export function normalizeCwd(cwd: string): string {
  const withForwardSlashes = cwd.replace(/\\/g, "/");
  const withoutTrailingSlashes = withForwardSlashes.replace(/\/+$/, "") || (withForwardSlashes.startsWith("/") ? "/" : "");
  return withoutTrailingSlashes.replace(/^([A-Z]):(?=\/|$)/, (_, drive: string) => `${drive.toLowerCase()}:`);
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
 * lossy (`/my-repo` and `/my/repo` collide).
 */
export function claudeProjectDirectoryNames(requestedCwd: string): string[] {
  const cwd = normalizeCwd(requestedCwd);
  if (!cwd) {
    return [];
  }

  const parts = cwd.split("/").filter(Boolean);
  const ancestors: string[] = [];
  if (cwd.startsWith("/")) {
    ancestors.push("/");
    let current = "";
    for (const part of parts) {
      current += `/${part}`;
      ancestors.push(current);
    }
  } else {
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      ancestors.push(current);
    }
  }

  return [...new Set(ancestors.map(encodeClaudeProjectCwd))];
}
