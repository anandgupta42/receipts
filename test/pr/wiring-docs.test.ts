// SPEC-0019/SPEC-0037 — harness wiring is present (build-spec step +
// PR-template Evidence mention), the repo-integration doc is a ≤5-step task,
// and the PR receipt docs keep the one-command finalizer as the primary path.
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("R4 harness wiring", () => {
  it("build-spec step 7 tells the agent to run `npx aireceipts-cli pr --post`", () => {
    const skill = read(".claude/skills/build-spec/SKILL.md");
    expect(skill).toContain("npx aireceipts-cli pr --post");
    expect(skill).toContain("SPEC-0037");
  });

  it("the PR template's Evidence section names the one-command receipt finalizer", () => {
    const tmpl = read(".github/pull_request_template.md");
    const evidence = tmpl.slice(tmpl.indexOf("## Evidence"));
    expect(evidence).toContain("npx aireceipts-cli pr --post");
    expect(evidence).toContain("SPEC-0037");
  });

  it("the CI presence workflow is notice-only by default with opt-in enforcement", () => {
    const wf = read(".github/workflows/pr-receipt-check.yml");
    expect(wf).toContain("scripts/check-pr-receipt.mjs");
    expect(wf).toContain("AIRECEIPTS_REQUIRE_PR_RECEIPT");
    expect(wf).toContain("--require-same-repo");
    expect(wf).toContain("missing-required");
    expect(wf).toContain("missing-notice");
    expect(wf).toContain("::notice::");
    expect(wf).toContain("exit 1");
  });
});

describe("R6 integration doc", () => {
  const doc = read("docs/pr-receipts.md");

  it("starts contributor guidance with the one posting command, not the dry-run or alias", () => {
    const section = doc.slice(doc.indexOf("For contributors"));
    const firstFence = section.match(/```sh\n([\s\S]*?)\n```/);
    expect(firstFence?.[1].trim()).toBe("npx aireceipts-cli pr --post");
    expect(section.indexOf("npx aireceipts-cli pr --post")).toBeLessThan(section.indexOf("npx aireceipts-cli pr\n"));
    expect(section.indexOf("npx aireceipts-cli pr --post")).toBeLessThan(section.indexOf("git config alias.receipt"));
  });

  it("documents one assistant-agnostic instruction snippet", () => {
    expect(doc).toContain("Use the same instruction for every coding assistant");
    expect(doc).toContain(
      "Before you finish a PR-producing task, run `npx aireceipts-cli pr --post` from the repo worktree and include any failure message in the handoff.",
    );
    expect(doc).toContain("Codex, Claude Code, OpenCode, Cursor");
  });

  it("keeps aliases and hooks optional rather than required for adoption", () => {
    expect(doc).toContain("Optional convenience: git alias");
    expect(doc).toContain("not required for adoption");
    const hookDoc = read("docs/guide/03-install-hook.md");
    expect(hookDoc).toContain("npx aireceipts-cli pr --post");
    expect(hookDoc).toContain("optional");
    expect(hookDoc).toContain("not the PR workflow");
  });

  it("names the copy-one-workflow file and the one CONTRIBUTING line", () => {
    expect(doc).toContain("pr-receipt-check.yml");
    expect(doc).toContain("CONTRIBUTING");
    expect(doc).toContain("npx aireceipts-cli pr --post");
  });

  it("the maintainer integration is at most 5 numbered steps", () => {
    const section = doc.slice(doc.indexOf("For maintainers"));
    const steps = section.match(/^\d+\.\s/gm) ?? [];
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.length).toBeLessThanOrEqual(5);
  });
});
