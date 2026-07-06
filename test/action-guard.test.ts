// SPEC-0057 — the root composite action can never drift from the script it
// wraps: metadata shape pinned (Marketplace requirements), verdict logic
// stays in scripts/check-pr-receipt.mjs (no duplicated truths), and the
// checkout targets THIS repo at the action's own ref (a PR must not supply
// the logic it is checked by).
import { readFileSync } from "node:fs";
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

  it("R1: the checkout step pins this repo at the action's own ref — never the caller's repo", () => {
    const checkout = action.runs.steps.find((s) => s.uses?.startsWith("actions/checkout@"));
    expect(checkout, "action must check out the verdict script").toBeDefined();
    expect(checkout!.with?.repository).toBe("anandgupta42/receipts");
    expect(checkout!.with?.ref).toContain("github.action_ref");
    // Pinned by full commit SHA, not a floating tag (supply-chain hygiene).
    expect(checkout!.uses).toMatch(/actions\/checkout@[0-9a-f]{40}/);
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

  it("R4: the paste-ready adopter workflow exists and points at this repo's action", () => {
    const caller = readFileSync("docs/adopt/pr-receipt-check-action.yml", "utf8");
    const parsed = load(caller) as { on: unknown; jobs: Record<string, { steps: { uses?: string }[] }> };
    expect(parsed.jobs.check.steps.some((s) => s.uses?.startsWith("anandgupta42/receipts@"))).toBe(true);
  });
});
