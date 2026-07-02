// R4 per-project bucket derivation (opt-in `--by-project` only). Path-derived
// grouping is deliberately brittle and privacy-adjacent (S2), so the rule is
// fixed and documented rather than clever: take the `~/.claude/projects/
// <encoded-cwd>` path segment, decode it by the `-`→`/` scheme Claude Code
// uses, and keep the last path component. Any session whose file path has no
// such segment (Codex, Cursor, or an unrecognized layout) buckets under
// `(unknown)` — never a fabricated project name.

export const UNKNOWN_PROJECT = "(unknown)";

/**
 * Derive a project bucket name from a session file path.
 *
 * The `<encoded-cwd>` segment directly under `.claude/projects/` is Claude
 * Code's `/`→`-` encoding of the working directory. Decoding is exactly the
 * inverse substitution (`-`→`/`) with the last path component kept — a lossy
 * scheme (a real `-` in a directory name is indistinguishable from an encoded
 * `/`), which is precisely why this stays behind an opt-in flag.
 */
export function deriveProjectBucket(filePath: string): string {
  const parts = filePath.split(/[/\\]+/);
  const idx = parts.findIndex((p, i) => p === "projects" && parts[i - 1] === ".claude");
  if (idx === -1 || idx + 1 >= parts.length) {
    return UNKNOWN_PROJECT;
  }
  const encoded = parts[idx + 1];
  if (!encoded) {
    return UNKNOWN_PROJECT;
  }
  const last = encoded
    .replace(/-/g, "/")
    .split("/")
    .filter((seg) => seg.length > 0)
    .pop();
  return last ?? UNKNOWN_PROJECT;
}
