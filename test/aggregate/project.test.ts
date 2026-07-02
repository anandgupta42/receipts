// R4: exact encoded-cwd derivation + `(unknown)` fallback. This is the
// "fixture of encoded-path shapes" the spec's test matrix calls for — a table
// of the path shapes the rule must decode, including the deliberately brittle
// dash-in-directory-name case that S2 flags as the reason it's opt-in.
import { describe, expect, it } from "vitest";
import { deriveProjectBucket, UNKNOWN_PROJECT } from "../../src/aggregate/project.js";

describe("deriveProjectBucket (R4 encoded-cwd shapes)", () => {
  const shapes: Array<[string, string]> = [
    ["/Users/me/.claude/projects/-Users-me-codebase-aireceipts/abc123.jsonl", "aireceipts"],
    // Brittle by design: a literal `-` in the real dir name is indistinguishable
    // from an encoded `/`, so it decodes into an extra path segment.
    ["/Users/me/.claude/projects/-Users-me-codebase-aireceipts-spec0008/abc123.jsonl", "spec0008"],
    ["/home/dev/.claude/projects/-home-dev-proj/session.jsonl", "proj"],
    ["/x/.claude/projects/-single/session.jsonl", "single"],
    // A Claude Code session nested a directory deeper still resolves the segment
    // directly under `projects/`.
    ["/root/.claude/projects/-a-b-c/sub/session.jsonl", "c"],
  ];
  for (const [filePath, expected] of shapes) {
    it(`decodes ${filePath} → ${expected}`, () => {
      expect(deriveProjectBucket(filePath)).toBe(expected);
    });
  }

  it("buckets a Codex path (no .claude/projects segment) under (unknown)", () => {
    expect(deriveProjectBucket("/Users/me/.codex/sessions/rollout-2026-06-15.jsonl")).toBe(UNKNOWN_PROJECT);
  });

  it("buckets a Cursor db path under (unknown)", () => {
    expect(deriveProjectBucket("/Users/me/Library/Application Support/Cursor/state.vscdb")).toBe(UNKNOWN_PROJECT);
  });

  it("returns (unknown) for an all-separator or empty encoded segment", () => {
    expect(deriveProjectBucket("/x/.claude/projects/---/s.jsonl")).toBe(UNKNOWN_PROJECT);
    expect(deriveProjectBucket("/x/.claude/projects")).toBe(UNKNOWN_PROJECT);
  });

  it("does not treat a bare 'projects' dir not under '.claude' as a bucket source", () => {
    expect(deriveProjectBucket("/var/projects/-a-b/s.jsonl")).toBe(UNKNOWN_PROJECT);
  });
});
