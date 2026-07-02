// SPEC-0019 R4/R6 — harness wiring is present (build-spec step + PR-template
// Evidence mention) and the repo-integration doc is a ≤5-step task.
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("R4 harness wiring", () => {
  it("build-spec step 7 tells the agent to run `aireceipts pr --post`", () => {
    const skill = read(".claude/skills/build-spec/SKILL.md");
    expect(skill).toContain("aireceipts pr --post");
  });

  it("the PR template's Evidence section mentions the receipt comment", () => {
    const tmpl = read(".github/pull_request_template.md");
    const evidence = tmpl.slice(tmpl.indexOf("## Evidence"));
    expect(evidence).toContain("aireceipts pr --post");
  });

  it("the CI presence workflow is a thin caller emitting a neutral notice, never a failure", () => {
    const wf = read(".github/workflows/pr-receipt-check.yml");
    expect(wf).toContain("scripts/check-pr-receipt.mjs");
    expect(wf).toContain("::notice::");
    expect(wf).not.toContain("exit 1");
  });
});

describe("R6 integration doc", () => {
  const doc = read("docs/pr-receipts.md");

  it("names the copy-one-workflow file and the one CONTRIBUTING line", () => {
    expect(doc).toContain("pr-receipt-check.yml");
    expect(doc).toContain("CONTRIBUTING");
    expect(doc).toContain("npx aireceipts pr --post");
  });

  it("the maintainer integration is at most 5 numbered steps", () => {
    const section = doc.slice(doc.indexOf("For maintainers"));
    const steps = section.match(/^\d+\.\s/gm) ?? [];
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.length).toBeLessThanOrEqual(5);
  });
});
