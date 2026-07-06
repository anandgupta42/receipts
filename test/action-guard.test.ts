// SPEC-0057 — the root composite action can never drift from the script it
// wraps: metadata shape pinned (Marketplace requirements), verdict logic
// stays in scripts/check-pr-receipt.mjs (no duplicated truths), and the
// checkout targets THIS repo at the action's own ref (a PR must not supply
// the logic it is checked by).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const raw = readFileSync("action.yml", "utf8");

interface ActionYml {
  name: string;
  description: string;
  branding?: { icon?: string; color?: string };
  inputs?: Record<string, { default?: string; required?: boolean }>;
  runs: { using: string; steps: { uses?: string; run?: string; with?: Record<string, string> }[] };
}

const action = load(raw) as ActionYml;

describe("SPEC-0057 · root action guard", () => {
  it("R1/R3: composite action with Marketplace-required metadata and safe input defaults", () => {
    expect(action.runs.using).toBe("composite");
    expect(action.name).toBeTruthy();
    expect(action.description).toBeTruthy();
    expect(action.branding?.icon).toBeTruthy();
    expect(action.branding?.color).toBeTruthy();
    // Notice-only by default; the token defaults to the workflow's own.
    expect(action.inputs?.["require-receipt"]?.default).toBe("false");
    expect(action.inputs?.["github-token"]?.default).toContain("github.token");
  });

  it("R1: the verdict script runs from the action's own materialized files, never the caller's workspace", () => {
    // No checkout step: the runner materializes the action's files at
    // github.action_path at the caller-pinned ref; a self-checkout with
    // github.action_ref would resolve the WRONG ref inside a composite step
    // (it names the current action step's ref — caught in review, 2026-07-05).
    expect(action.runs.steps.some((s) => s.uses !== undefined)).toBe(false);
    const step = action.runs.steps.find((s) => s.run !== undefined)!;
    const env = (step as { env?: Record<string, string> }).env ?? {};
    expect(env.ACTION_PATH).toContain("github.action_path");
    expect(step.run).toContain('"$ACTION_PATH/scripts/check-pr-receipt.mjs"');
  });

  it("R1: scratch files live under RUNNER_TEMP, never the caller's workspace", () => {
    const run = action.runs.steps.find((s) => s.run !== undefined)?.run ?? "";
    expect(run).toContain("mktemp");
    expect(run).toContain("RUNNER_TEMP");
    expect(run).not.toMatch(/> ?comments\.json/);
  });

  it("R2: verdict logic is the shared script, not YAML re-implementation", () => {
    const run = action.runs.steps.find((s) => s.run !== undefined)?.run ?? "";
    expect(run).toContain("scripts/check-pr-receipt.mjs");
    // The marker heuristic must not be re-implemented inline: the only
    // verdict-string occurrences are the case arms consuming script output.
    expect(run).not.toContain("aireceipts-dogfood");
    expect(run).toContain("--head-repo");
    expect(run).toContain("--base-repo");
    expect(run).toContain("--require-same-repo");
  });

  it("R1 semantics: a live run through the real script yields the workflow's verdicts", () => {
    // Simulate the action's inner command against the shared script — the same
    // arg plumbing the YAML performs, exercised for all three verdicts.
    const found = JSON.stringify([{ body: "<!-- aireceipts-dogfood -->\nreceipt" }]);
    const none = "[]";
    const run = (json: string, requireSameRepo: boolean, sameRepo: boolean): string => {
      const file = join(mkdtempSync(join(tmpdir(), "aireceipts-action-")), "comments.json");
      writeFileSync(file, json);
      const args = [file, "--head-repo", sameRepo ? "o/r" : "fork/r", "--base-repo", "o/r"];
      if (requireSameRepo) args.push("--require-same-repo");
      return execFileSync("node", ["scripts/check-pr-receipt.mjs", ...args], { encoding: "utf8" }).trim();
    };
    expect(run(found, true, true)).toBe("found");
    expect(run(none, true, true)).toBe("missing-required");
    expect(run(none, true, false)).toBe("missing-notice");
    expect(run(none, false, true)).toBe("missing-notice");
  });

  it("R4: the paste-ready adopter workflow exists and points at this repo's action", () => {
    const caller = readFileSync("docs/adopt/pr-receipt-check-action.yml", "utf8");
    const parsed = load(caller) as { on: unknown; jobs: Record<string, { steps: { uses?: string }[] }> };
    expect(parsed.jobs.check.steps.some((s) => s.uses?.startsWith("anandgupta42/receipts@"))).toBe(true);
  });
});
