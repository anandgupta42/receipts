#!/usr/bin/env node
// The one command to run before you push a PR:
//
//   npm run ship-check -- --title "<your PR title>"
//
// Runs every FAST gate CI enforces, locally, in one shot: `preflight --quick`
// (manifest, build, tarball, tsc, eslint, cite-check, verify-goldens, spec-lint,
// hygiene, and the README guard) plus — when --title is given — the same
// PR-title lint CI runs. Green here means green on CI's fast checks, so a
// mechanical failure never bounces off CI or a reviewer.
//
// This is NOT release-valid on its own (it skips the full vitest suite +
// determinism ×10, like preflight --quick). Run `npm run preflight` before a
// release; run this before a PR.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const ti = argv.indexOf("--title");
const title = ti >= 0 ? argv[ti + 1] : undefined;

function step(name, cmd, args) {
  process.stdout.write(`\n▶ ${name}\n`);
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
  if (res.status !== 0) {
    console.error(`\nship-check: FAILED at "${name}" — fix it before pushing.`);
    process.exit(1);
  }
}

step("preflight --quick", "node", ["scripts/preflight-release.mjs", "--quick"]);
if (title) {
  step("pr-title lint", "node", ["scripts/hygiene.mjs", "--title", title]);
} else {
  console.log('\n(no --title given — skipping the PR-title lint; pass --title "<PR title>" to check it before you open the PR)');
}
console.log("\nship-check: OK — safe to push.");
