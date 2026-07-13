#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { arch, platform, release, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { performance } from "node:perf_hooks";
import { listFullSessions, OpenCodeAdapter } from "../dist/index.js";

function parseRuns(argv) {
  let runs = 2;
  let json = false;
  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    const match = /^--runs=(\d+)$/u.exec(arg);
    if (match) {
      runs = Number.parseInt(match[1], 10);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!json) {
    throw new Error("--json is required");
  }
  if (!Number.isInteger(runs) || runs < 2) {
    throw new Error("--runs must be an integer >= 2");
  }
  return runs;
}

async function candidates(roots) {
  const paths = new Set();
  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".db")) {
        paths.add(join(root, entry.name));
      }
    }
  }
  return [...paths].sort();
}

function maxRssMiB() {
  return Math.round((process.resourceUsage().maxRSS / 1024) * 10) / 10;
}

async function main() {
  const runs = parseRuns(process.argv.slice(2));
  if (process.env.OPENCODE_DB_PATH || process.env.OPENCODE_DB) {
    throw new Error("unset forced database overrides before measuring multi-root discovery");
  }

  const adapter = new OpenCodeAdapter();
  const roots = adapter.roots();
  const databasePaths = await candidates(roots);
  const runResults = [];
  const cacheHome = await mkdtemp(join(tmpdir(), "aireceipts-opencode-measure-"));
  process.env.AIRECEIPTS_HOME = cacheHome;
  try {
    for (let run = 0; run < runs; run++) {
      const started = performance.now();
      const sessions = await listFullSessions("opencode");
      runResults.push({
        sessionCount: sessions.length,
        wallTimeMs: Math.round((performance.now() - started) * 10) / 10,
      });
    }
  } finally {
    await rm(cacheHome, { recursive: true, force: true });
  }

  let nonPrefixedSessionCount = 0;
  const nonPrefixed = databasePaths.filter((dbPath) => !basename(dbPath).startsWith("opencode"));
  for (const dbPath of nonPrefixed) {
    nonPrefixedSessionCount += (await new OpenCodeAdapter({ dbPath }).listSessions()).length;
  }

  const result = {
    spec: "SPEC-0082",
    baselineSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    measuredAt: new Date().toISOString(),
    runtime: { node: process.version, platform: platform(), release: release(), arch: arch() },
    configuredRootCount: roots.length,
    candidateDatabaseCount: databasePaths.length,
    nonPrefixedCandidateCount: nonPrefixed.length,
    nonPrefixedSessionCount,
    runs: runResults,
    maxRssMiB: maxRssMiB(),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`measure-opencode-discovery: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
