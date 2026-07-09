// SPEC-0075 R1 — pure cwd attribution rules and Claude Code's lossy project
// directory encoding. These tests never inspect the developer's real home.
import { describe, expect, it } from "vitest";
import {
  claudeProjectDirectoryNames,
  cwdMatches,
  cwdMatchesForAttribution,
  encodeClaudeProjectCwd,
  normalizeCwd,
} from "../../src/parse/cwdScope.js";

describe("SPEC-0075 R1 cwd matching", () => {
  it("matches equal POSIX paths", () => {
    expect(cwdMatches("/repo", "/repo")).toBe(true);
  });

  it("matches only whole-segment ancestor prefixes", () => {
    expect(cwdMatches("/repo", "/repo/sub")).toBe(true);
    expect(cwdMatches("/repo", "/repo-old")).toBe(false);
  });

  it("strips trailing separators", () => {
    expect(cwdMatches("/repo/", "/repo/sub/")).toBe(true);
  });

  it("matches when the requested cwd is deeper than the session cwd", () => {
    expect(cwdMatches("/repo", "/repo/sub/dir")).toBe(true);
  });

  it("normalizes Windows separators and folds only the drive letter", () => {
    expect(cwdMatches("c:/repo", String.raw`C:\repo\sub`)).toBe(true);
    expect(normalizeCwd("C:\\Repo\\")).toBe("c:/Repo");
    expect(cwdMatches("c:/Repo", "c:/repo/sub")).toBe(false);
  });

  it("resolves dot segments lexically — a traversal never matches the traversed-out project", () => {
    expect(normalizeCwd("/repo/../other")).toBe("/other");
    expect(cwdMatches("/repo", "/repo/../other")).toBe(false);
    expect(cwdMatches("/other", "/repo/../other")).toBe(true);
    expect(normalizeCwd("/repo/./sub")).toBe("/repo/sub");
    expect(normalizeCwd("/../..")).toBe("/");
  });

  it("collapses duplicate interior slashes and keeps a UNC prefix", () => {
    expect(normalizeCwd("/repo//sub///dir")).toBe("/repo/sub/dir");
    expect(normalizeCwd(String.raw`\\server\share\repo`)).toBe("//server/share/repo");
    expect(cwdMatches("//server/share/repo", String.raw`\\server\share\repo\sub`)).toBe(true);
  });

  it("keeps a relative session cwd from matching an unrelated absolute path", () => {
    expect(cwdMatches("repo", "/repo/sub")).toBe(false);
    expect(cwdMatches("../repo", "/repo")).toBe(false);
  });

  it("treats a drive prefix as a root boundary that `..` can never pop", () => {
    expect(normalizeCwd("C:/../Other")).toBe("c:/Other");
    expect(normalizeCwd("C:/..")).toBe("c:");
    expect(cwdMatches("Other", "C:/../Other")).toBe(false);
    expect(cwdMatches("c:/Other", "C:/../Other")).toBe(true);
  });
});

describe("SPEC-0075 R1 attribution policy (home-shadow guard)", () => {
  const home = "/Users/dev";

  it("never ancestor-matches a session recorded at the home directory or above", () => {
    // Observed on real data: one `~`-launched Codex session is an ancestor of
    // every path on the machine and would shadow the placeholder forever.
    expect(cwdMatchesForAttribution(home, "/Users/dev/never-used", home)).toBe(false);
    expect(cwdMatchesForAttribution("/Users", "/Users/dev/repo", home)).toBe(false);
    expect(cwdMatchesForAttribution("/", "/Users/dev/repo", home)).toBe(false);
  });

  it("still exact-matches a home-directory session for a home-directory pane", () => {
    expect(cwdMatchesForAttribution(home, home, home)).toBe(true);
  });

  it("keeps ancestor matching for real project roots below home and outside it", () => {
    expect(cwdMatchesForAttribution("/Users/dev/repo", "/Users/dev/repo/sub", home)).toBe(true);
    expect(cwdMatchesForAttribution("/srv/app", "/srv/app/sub", home)).toBe(true);
  });

  it("blocks a root-recorded session even when the home directory is unknown", () => {
    expect(cwdMatchesForAttribution("/", "/project", "")).toBe(false);
    expect(cwdMatchesForAttribution("/", "/", "")).toBe(true);
  });

  it("normalizes the home argument itself (trailing slash, Windows drive fold)", () => {
    expect(cwdMatchesForAttribution("/Users/dev", "/Users/dev/x", "/Users/dev/")).toBe(false);
    expect(cwdMatchesForAttribution("c:/Users/dev", "c:/Users/dev/x", String.raw`C:\Users\dev`)).toBe(false);
    expect(cwdMatchesForAttribution("c:/Users/dev/repo", "c:/Users/dev/repo/x", String.raw`C:\Users\dev`)).toBe(true);
  });
});

describe("SPEC-0075 R1 Claude Code cwd encoding", () => {
  it("replaces every non-ASCII-alphanumeric character with a dash", () => {
    expect(encodeClaudeProjectCwd("/my/repo")).toBe("-my-repo");
    expect(encodeClaudeProjectCwd("/my/.repo_name")).toBe("-my--repo-name");
  });

  it("matches Claude Code's observed worktree directory name", () => {
    expect(encodeClaudeProjectCwd("/Users/x/codebase/aireceipts/.claude/worktrees/add_status_line_codex")).toBe(
      "-Users-x-codebase-aireceipts--claude-worktrees-add-status-line-codex",
    );
  });

  it("computes ancestor lookups before encoding", () => {
    expect(claudeProjectDirectoryNames("/my/repo")).toEqual(["-", "-my", "-my-repo"]);
  });

  it("keeps both UNC leading slashes in encoded ancestor names", () => {
    expect(claudeProjectDirectoryNames("//server/share/repo")).toEqual([
      "--server",
      "--server-share",
      "--server-share-repo",
    ]);
  });
});
