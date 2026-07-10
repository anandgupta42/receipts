// SPEC-0030 R4 — the org dogfood rollout REPORT. Enumerates active repos in
// an org and emits a per-repo adoption packet (caller workflow + CONTRIBUTING
// line + copy-paste command sheet). REPORT-ONLY BY DESIGN: it performs no
// repo or GitHub mutations (local temp/cache writes by the compile wrapper
// and npm/gh are out of scope of the claim) —
// workflow-file writes need `workflow`-scope tokens per repo, an auth surface
// deliberately not automated until manual adoptions prove the caller.
// Refuses to run before `aireceipts` is on npm (kill criterion b): a packet
// telling developers to run an unpublished command is a credibility bug.
//
//   node scripts/rollout-dogfood.mjs --org <github-org> [--days 90]
//
// Exit codes: 0 = packet printed; 1 = usage/api error; 2 = npm gate refused.
import type { CommandRunner } from "../src/pr/git.js";
import { defaultRunner } from "../src/pr/git.js";

export const CALLER_PATH = ".github/workflows/pr-receipt-check.yml";
export const CALLER_YAML = `name: pr-receipt-check
on: [pull_request]
permissions:
  contents: read
  pull-requests: write
jobs:
  check:
    uses: anandgupta42/receipts/.github/workflows/pr-receipt-check.yml@latest
`;
export const CONTRIBUTING_LINE =
  "After opening or updating a PR, run `npx aireceipts-cli pr --post` to attach your build receipt.";

export interface RepoInfo {
  name: string;
  archived: boolean;
  fork: boolean;
  pushed_at: string;
}

/** Kill criterion (b): no packet before the CLI is installable. */
export function npmPublished(run: CommandRunner): boolean {
  const res = run("npm", ["view", "aireceipts-cli", "version"]);
  return res.code === 0 && /\d+\.\d+\.\d+/.test(res.stdout);
}

/** Active = pushed within `days`, not archived, not a fork. */
export function activeRepos(repos: RepoInfo[], days: number, nowMs: number): RepoInfo[] {
  const cutoff = nowMs - days * 86_400_000;
  return repos.filter((r) => !r.archived && !r.fork && Date.parse(r.pushed_at) >= cutoff);
}

export function listOrgRepos(run: CommandRunner, org: string): RepoInfo[] | { error: string } {
  const res = run("gh", ["api", "--paginate", `orgs/${org}/repos?per_page=100`, "--jq", ".[] | {name, archived, fork, pushed_at}"]);
  if (res.code !== 0) {
    return { error: `could not list ${org} repos: ${res.stderr.trim()}` };
  }
  return res.stdout
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as RepoInfo);
}

/** True when the repo already carries the caller (idempotence — skipped with a note). */
export function hasCaller(run: CommandRunner, org: string, repo: string): boolean {
  return run("gh", ["api", `repos/${org}/${repo}/contents/${encodeURIComponent(CALLER_PATH)}`]).code === 0;
}

export function packetFor(org: string, repo: string): string {
  return [
    `### ${org}/${repo}`,
    "",
    `1. Add \`${CALLER_PATH}\`:`,
    "```yaml",
    CALLER_YAML.trimEnd(),
    "```",
    `2. Add to CONTRIBUTING.md: "${CONTRIBUTING_LINE}"`,
    "3. Command sheet:",
    "```sh",
    `gh repo clone ${org}/${repo} && cd ${repo}`,
    `git checkout -b chore/aireceipts-dogfood`,
    `mkdir -p .github/workflows && cat > ${CALLER_PATH} <<'YAML'`,
    CALLER_YAML.trimEnd(),
    "YAML",
    `git add ${CALLER_PATH} && git commit -m "chore: adopt aireceipts PR-receipt check"`,
    `git push -u origin chore/aireceipts-dogfood`,
    `gh pr create --title "chore: adopt aireceipts PR-receipt check" --body "Notice-only check; never fails the build. See https://github.com/anandgupta42/receipts/blob/main/docs/pr-receipts.md"`,
    "```",
    "",
  ].join("\n");
}

export function buildReport(run: CommandRunner, org: string, days: number, nowMs: number): { text: string; code: number } {
  if (!npmPublished(run)) {
    return {
      text: "REFUSED (kill criterion b): `aireceipts` is not on npm yet — a rollout packet telling developers to run an unpublished command is a credibility bug. Publish v0.1.0 first.",
      code: 2,
    };
  }
  const repos = listOrgRepos(run, org);
  if (!Array.isArray(repos)) {
    return { text: repos.error, code: 1 };
  }
  const active = activeRepos(repos, days, nowMs);
  const lines: string[] = [`# aireceipts dogfood rollout packet — ${org} (active last ${days}d: ${active.length}/${repos.length})`, ""];
  for (const r of active) {
    if (hasCaller(run, org, r.name)) {
      lines.push(`- ${org}/${r.name}: already carries the caller — skipped.`);
      continue;
    }
    lines.push(packetFor(org, r.name));
  }
  lines.push("", "Report-only: no repo or GitHub mutations were performed. Each repo's owners merge their own PR.");
  return { text: lines.join("\n"), code: 0 };
}

function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (i >= 0 && (v === undefined || v.startsWith("--"))) {
    console.error(`${flag} requires a value`);
    process.exit(1);
  }
  return v ?? fallback;
}

const ORG_USAGE = "Usage: node scripts/rollout-dogfood.mjs --org <github-org> [--days 90]";

/** `--org` has no default — pure so the missing-arg path is testable without exiting. */
export function parseOrgArg(argv: string[]): { org: string } | { error: string } {
  const i = argv.indexOf("--org");
  const v = i >= 0 ? argv[i + 1] : undefined;
  if (i < 0 || v === undefined || v.startsWith("--")) {
    return { error: ORG_USAGE };
  }
  return { org: v };
}

if (process.argv[1]?.endsWith("rollout-dogfood.mjs")) {
  const orgResult = parseOrgArg(process.argv);
  if ("error" in orgResult) {
    console.error(orgResult.error);
    process.exit(1);
  }
  const org = orgResult.org;
  const days = Number.parseInt(argValue("--days", "90"), 10);
  if (!Number.isInteger(days) || days <= 0) {
    console.error("--days must be a positive integer");
    process.exit(1);
  }
  const { text, code } = buildReport(defaultRunner, org, days, globalThis.Date.now());
  (code === 0 ? console.log : console.error)(text);
  process.exit(code);
}
