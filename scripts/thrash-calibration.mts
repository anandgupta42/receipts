// SPEC-0017 kill criterion + issue #46 — the labeled clean-corpus precision
// gate for the context-thrash detector. Maintainer-run, local-only: the corpus
// manifest points at real transcripts on this machine and is never committed
// (eval/clean-corpus.local.json is gitignored — file paths are private, I4).
//
//   node scripts/thrash-calibration.mjs --init [--limit N]   write a template
//     manifest of the newest local sessions, every entry UNLABELED — the
//     maintainer flips `labeledClean` to true and signs `labeledBy` per entry;
//     the tool never pre-labels a session clean.
//   node scripts/thrash-calibration.mjs [--corpus <path>]    run the gate.
//
// Exit codes (gate mode; --init exits 0 on a written template): 0 = N>=20
// labeled-clean sessions, 0 thrash firings (gate PASSES); 1 = a labeled-clean
// session fired (tune T/K/REFILL_RATIO before the waste line ships — issue
// #46) or usage error; 2 = evidence insufficient (fewer than 20 distinct
// labeled-clean loadable sessions — per SPEC-0017 the detector cannot ship on
// this evidence).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { listSessions, loadById } from "../src/index.js";
import type { AgentSource, SessionSummary } from "../src/parse/types.js";
import {
  CONTEXT_THRASH_K,
  CONTEXT_THRASH_MAX_GAP,
  CONTEXT_THRASH_REFILL_RATIO,
  detectContextThrash,
} from "../src/pricing/waste.js";

const DEFAULT_CORPUS = "eval/clean-corpus.local.json";
const MIN_CLEAN = 20;
const DEFAULT_INIT_LIMIT = 40;

interface CorpusEntry {
  source: AgentSource;
  path: string;
  title?: string;
  startedAt?: string;
  labeledClean: boolean;
  labeledBy: string;
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) {
    return undefined;
  }
  const value = process.argv[i + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`${flag} requires a value`);
    process.exit(1);
  }
  return value;
}

function thresholds(): string {
  return `T(max gap)=${CONTEXT_THRASH_MAX_GAP} turns · K(refill window)=${CONTEXT_THRASH_K} turns · refill ratio=${CONTEXT_THRASH_REFILL_RATIO}`;
}

async function init(corpusPath: string, limit: number): Promise<number> {
  if (existsSync(corpusPath)) {
    console.error(`refusing to overwrite ${corpusPath} — delete it first if you mean to relabel from scratch`);
    return 1;
  }
  const sessions = await listSessions();
  const newest = sessions
    .filter((s: SessionSummary) => s.startedAt !== undefined)
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0) || a.filePath.localeCompare(b.filePath))
    .slice(0, limit);
  const entries: CorpusEntry[] = newest.map((s) => ({
    source: s.source,
    path: s.filePath,
    title: s.title,
    startedAt: s.startedAt !== undefined ? new Date(s.startedAt).toISOString() : undefined,
    labeledClean: false,
    labeledBy: "",
  }));
  const manifest = {
    $schema:
      "maintainer-labeled clean corpus for the context-thrash precision gate (SPEC-0017 kill criterion, issue #46). " +
      "For every session you have REVIEWED and judged free of context thrash, set labeledClean: true and put your " +
      "name in labeledBy. Unreviewed entries stay false and are ignored. Local-only file — never commit it.",
    entries,
  };
  writeFileSync(corpusPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${corpusPath} with ${entries.length} UNLABELED sessions.`);
  console.log(`label >= ${MIN_CLEAN} clean sessions (labeledClean: true + labeledBy), then rerun without --init.`);
  return 0;
}

async function check(corpusPath: string): Promise<number> {
  if (!existsSync(corpusPath)) {
    console.error(`no corpus at ${corpusPath} — run with --init to scaffold one, then label it`);
    return 2;
  }
  const parsed = JSON.parse(readFileSync(corpusPath, "utf8")) as { entries?: CorpusEntry[] };
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  const seen = new Set<string>();
  const labeled: CorpusEntry[] = [];
  for (const e of entries
    .filter((e) => e.labeledClean === true && typeof e.labeledBy === "string" && e.labeledBy.trim() !== "")
    .sort((a, b) => a.path.localeCompare(b.path))) {
    // A duplicate (source, path) row is one session, not two pieces of evidence.
    const key = `${e.source} ${e.path}`;
    if (seen.has(key)) {
      console.error(`duplicate labeled entry (counted once): ${e.path}`);
      continue;
    }
    seen.add(key);
    labeled.push(e);
  }

  const unloadable: string[] = [];
  const firings: { path: string; compactionCount: number; turnSpan: number }[] = [];
  let checked = 0;
  for (const entry of labeled) {
    const session = await loadById(entry.source, entry.path);
    if (!session) {
      unloadable.push(entry.path);
      continue;
    }
    checked++;
    for (const finding of await detectContextThrash(session)) {
      firings.push({ path: entry.path, compactionCount: finding.compactionCount, turnSpan: finding.turnSpan });
    }
  }

  for (const path of unloadable) {
    console.error(`unloadable labeled session (excluded from evidence): ${path}`);
  }
  if (checked < MIN_CLEAN) {
    console.error(
      `evidence insufficient: ${checked} loadable labeled-clean session(s) < ${MIN_CLEAN} ` +
        `(SPEC-0017 kill criterion) — the context-thrash line cannot ship on this corpus.`,
    );
    return 2;
  }
  if (firings.length > 0) {
    for (const f of firings) {
      console.error(
        `FALSE POSITIVE: ${f.path} fired context-thrash (${f.compactionCount} compactions over ${f.turnSpan} turns)`,
      );
    }
    console.error(`${firings.length} firing(s) on labeled-clean sessions at ${thresholds()}.`);
    console.error("tune the thresholds (issue #46) before the v0.1.0 release-manager verdict.");
    return 1;
  }
  console.log(`PASS: 0 false positives on ${checked} maintainer-labeled clean sessions at ${thresholds()}.`);
  return 0;
}

// Strict argv: an unrecognized flag must never silently fall through to the
// default corpus and print a PASS the maintainer didn't ask for.
{
  const valueFlags = new Set(["--corpus", "--limit"]);
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--init") {
      continue;
    }
    if (valueFlags.has(args[i])) {
      i++;
      continue;
    }
    console.error(`unknown argument "${args[i]}" — usage: [--init] [--limit N] [--corpus <path>]`);
    process.exit(1);
  }
}
const corpusPath = argValue("--corpus") ?? DEFAULT_CORPUS;
const limitRaw = argValue("--limit");
if (limitRaw !== undefined && !/^[1-9]\d*$/.test(limitRaw)) {
  console.error(`--limit must be a positive integer, got "${limitRaw}"`);
  process.exit(1);
}
const limit = limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : DEFAULT_INIT_LIMIT;
process.exit(process.argv.includes("--init") ? await init(corpusPath, limit) : await check(corpusPath));
