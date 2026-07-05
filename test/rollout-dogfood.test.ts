// SPEC-0030 R4 — the rollout report is REPORT-ONLY: publish-gated, filtered,
// idempotent, and provably write-free (every gh call it makes is a plain GET).
import { describe, expect, it } from "vitest";
import type { CommandResult } from "../src/pr/git.js";
import { activeRepos, buildReport, CALLER_YAML, parseOrgArg } from "../scripts/rollout-dogfood.mts";

const NOW = Date.parse("2026-07-03T00:00:00Z");
const day = 86_400_000;
const ok = (stdout: string): CommandResult => ({ stdout, stderr: "", code: 0, missing: false });
const fail = (stderr: string): CommandResult => ({ stdout: "", stderr, code: 1, missing: false });

function repoLine(name: string, daysAgo: number, extra: Partial<{ archived: boolean; fork: boolean }> = {}): string {
  return JSON.stringify({ name, archived: extra.archived ?? false, fork: extra.fork ?? false, pushed_at: new Date(NOW - daysAgo * day).toISOString() });
}

function runner(opts: { published: boolean; repos: string[]; withCaller: string[] }) {
  const calls: string[][] = [];
  const run = (cmd: string, args: string[]): CommandResult => {
    calls.push([cmd, ...args]);
    if (cmd === "npm") {
      return opts.published ? ok("0.1.0\n") : fail("404 Not Found");
    }
    if (args[0] === "api" && args.some((a) => a.startsWith("orgs/"))) {
      return ok(opts.repos.join("\n"));
    }
    if (args[0] === "api" && args[1]?.includes("/contents/")) {
      const repo = args[1].split("/")[2];
      return opts.withCaller.includes(repo) ? ok("{}") : fail("404");
    }
    return fail(`unexpected ${cmd} ${args[0]}`);
  };
  return { run, calls };
}

describe("SPEC-0030 R4 rollout report", () => {
  it("refuses before npm publish (kill criterion b), exit 2", () => {
    const { run } = runner({ published: false, repos: [], withCaller: [] });
    const r = buildReport(run, "example-org", 90, NOW);
    expect(r.code).toBe(2);
    expect(r.text).toContain("not on npm");
  });

  it("filters archived, forks, and stale repos", () => {
    const repos = [
      JSON.parse(repoLine("active", 5)),
      JSON.parse(repoLine("stale", 120)),
      JSON.parse(repoLine("archived", 5, { archived: true })),
      JSON.parse(repoLine("a-fork", 5, { fork: true })),
    ];
    expect(activeRepos(repos, 90, NOW).map((r) => r.name)).toEqual(["active"]);
  });

  it("skips repos already carrying the caller (idempotence) and packets the rest", () => {
    const { run } = runner({ published: true, repos: [repoLine("has-it", 3), repoLine("needs-it", 3)], withCaller: ["has-it"] });
    const r = buildReport(run, "example-org", 90, NOW);
    expect(r.code).toBe(0);
    expect(r.text).toContain("has-it: already carries the caller — skipped");
    expect(r.text).toContain("### example-org/needs-it");
    expect(r.text).toContain(CALLER_YAML.trimEnd());
  });

  it("has no built-in org default: --org is required and errors with usage on missing/flag-shaped value", () => {
    expect(parseOrgArg(["node", "rollout-dogfood.mjs", "--days", "90"])).toEqual({ error: expect.stringContaining("Usage:") });
    expect(parseOrgArg(["node", "rollout-dogfood.mjs", "--org"])).toEqual({ error: expect.stringContaining("Usage:") });
    expect(parseOrgArg(["node", "rollout-dogfood.mjs", "--org", "--days"])).toEqual({ error: expect.stringContaining("Usage:") });
    expect(parseOrgArg(["node", "rollout-dogfood.mjs", "--org", "example-org"])).toEqual({ org: "example-org" });
  });

  it("performs no GitHub mutations: every gh call is a plain read (no -X/-f/-F flags)", () => {
    const { run, calls } = runner({ published: true, repos: [repoLine("r1", 1), repoLine("r2", 2)], withCaller: [] });
    buildReport(run, "example-org", 90, NOW);
    for (const c of calls.filter((c) => c[0] === "gh")) {
      expect(c.some((a) => a === "-X" || a === "--method" || a === "-f" || a === "-F"), `mutating flag in: ${c.join(" ")}`).toBe(false);
    }
    expect(calls.length).toBeGreaterThan(0);
  });
});
