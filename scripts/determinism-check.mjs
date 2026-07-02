#!/usr/bin/env node
// Determinism harness (I1/I5, AGENTS.md): runs a given CLI command N times
// under a locale-pinned, color-stripped, UTC environment and byte-compares
// every run's stdout+stderr. Any drift between runs means the command is not
// deterministic — exits 1 and prints a diff of the first divergent run
// against the baseline (run #1).
//
// Skeleton only (Wave 4 pre-work): not wired into CI or the golden-fixture
// flow yet. It activates once the renderer lands and goldens exist — at that
// point a caller (likely `npm run verify:determinism` or similar) will pass
// a real `receipts` CLI invocation here.
//
// Usage:
//   node scripts/determinism-check.mjs [--runs=N] -- <command> [args...]
//
// Examples:
//   node scripts/determinism-check.mjs -- node dist/cli.js receipt --session foo.jsonl
//   node scripts/determinism-check.mjs --runs=50 -- node dist/cli.js receipt --session foo.jsonl
//
// Exit codes: 0 = all N runs byte-identical. 1 = drift detected, or usage error.

import { spawnSync } from "node:child_process";

const DEFAULT_RUNS = 20;

function parseArgs(argv) {
  const sepIndex = argv.indexOf("--");
  if (sepIndex === -1 || sepIndex === argv.length - 1) {
    return { error: 'missing command: usage is "determinism-check.mjs [--runs=N] -- <command> [args...]"' };
  }
  const flags = argv.slice(0, sepIndex);
  const command = argv.slice(sepIndex + 1);

  let runs = DEFAULT_RUNS;
  for (const flag of flags) {
    const match = /^--runs=(\d+)$/.exec(flag);
    if (match) {
      runs = Number.parseInt(match[1], 10);
      continue;
    }
    return { error: `unrecognized flag: ${flag}` };
  }
  if (!Number.isInteger(runs) || runs < 2) {
    return { error: `--runs must be an integer >= 2 (got ${runs})` };
  }

  return { runs, command };
}

function runOnce(command) {
  const [bin, ...args] = command;
  const result = spawnSync(bin, args, {
    env: {
      ...process.env,
      NO_COLOR: "1",
      TZ: "UTC",
      LANG: "C",
    },
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function firstDiffOffset(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : len;
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    console.error(`determinism-check: ${parsed.error}`);
    process.exit(1);
  }

  const { runs, command } = parsed;
  console.log(`determinism-check: running \`${command.join(" ")}\` ${runs} times (NO_COLOR=1 TZ=UTC LANG=C)...`);

  const baseline = runOnce(command);
  let driftFound = false;

  for (let i = 2; i <= runs; i++) {
    const attempt = runOnce(command);

    if (attempt.status !== baseline.status) {
      console.error(`determinism-check: DRIFT on run ${i}: exit status ${attempt.status} !== baseline ${baseline.status}`);
      driftFound = true;
      break;
    }

    const stdoutDiff = firstDiffOffset(baseline.stdout, attempt.stdout);
    if (stdoutDiff !== -1) {
      console.error(`determinism-check: DRIFT on run ${i}: stdout diverges from baseline at byte offset ${stdoutDiff}`);
      console.error(`  baseline: ...${JSON.stringify(baseline.stdout.slice(Math.max(0, stdoutDiff - 20), stdoutDiff + 20))}`);
      console.error(`  run ${i}:   ...${JSON.stringify(attempt.stdout.slice(Math.max(0, stdoutDiff - 20), stdoutDiff + 20))}`);
      driftFound = true;
      break;
    }

    const stderrDiff = firstDiffOffset(baseline.stderr, attempt.stderr);
    if (stderrDiff !== -1) {
      console.error(`determinism-check: DRIFT on run ${i}: stderr diverges from baseline at byte offset ${stderrDiff}`);
      driftFound = true;
      break;
    }
  }

  if (driftFound) {
    process.exit(1);
  }

  console.log(`determinism-check: all ${runs} runs byte-identical. OK.`);
  process.exit(0);
}

main();
