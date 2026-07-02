---
id: SPEC-0022
title: "Make transcript discovery lazy and cache full summaries"
status: building
milestone: M1
depends: [SPEC-0001, SPEC-0008, SPEC-0009, SPEC-0019]
---

# SPEC-0022: Discovery performance

Invariants: I1 (deterministic; zero model calls; zero product-path network), I2
(no fabricated dollars), I3 (every number traceable), I5 (byte-stable receipt
contract), I6 (facts, never rankings). This spec changes how session summaries are
found, not how receipts are priced or rendered.

## Purpose

Large local Claude Code and Codex archives should not make the default receipt command
parse every transcript before it can render one receipt. Discovery should read only
filesystem metadata plus the transcript's first JSONL line; commands that truly need
full summary totals should reuse a local cache keyed by the transcript file's path,
mtime, and size.

## Requirements

- **R1** — Lazy discovery for JSONL adapters reads path metadata plus the first JSONL
  line only, deriving the summary fields available there and leaving token/tool totals
  at zero until a full parse is explicitly requested.
- **R2** — The default no-selector receipt-like path selects the newest transcript by
  file mtime, then full-parses only that selected transcript.
- **R3** — Commands that need full summaries (`--list`, `week`, budget aggregation,
  compare/selector matching, PR attribution) use an incremental cache at
  `~/.aireceipts/cache.json`, keyed by path, mtime, and size. Missing, corrupt, or
  stale cache entries silently fall back to the existing full parser.
- **R4** — The cache is an optimization only: cached and uncached full-summary listing
  produce the same answers for the same files.
- **R5** — Discovery has a regression test with a synthetic 200-file corpus proving it
  does not read full transcript bodies.

## Scenarios

- **Given** 200 large JSONL transcripts **When** the default receipt command needs the
  newest session **Then** discovery inspects only each first line and stat metadata,
  then loads one selected file.
- **Given** `--list` is run twice over unchanged transcripts **When** the second run
  builds rows **Then** it reuses cached full summaries and does not change the output.
- **Given** `~/.aireceipts/cache.json` is missing or invalid JSON **When** full
  summaries are requested **Then** the command rebuilds from transcripts without
  surfacing a cache error.

## Non-goals

No receipt output change; no telemetry or remote cache; no background daemon; no
cache for Cursor's SQLite rows because multiple sessions share one database path.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1/R5 lazy bytes | 200 JSONL files with large trailing bodies | first-line reads only; totals remain lazy zeros |
| R2 newest mtime | no selector | mtime-newest lazy summary is selected before one full load |
| R3 rebuild | absent/corrupt cache | full summaries parse and cache is rewritten silently |
| R4 equivalence | same files, cached and uncached paths | byte/equality-equivalent summary arrays |
| existing goldens | committed fixtures | unchanged rendered output |

## Success criteria

- [ ] `npx tsc --noEmit`; `npx eslint . --max-warnings 0`; `npx vitest run`;
      `node scripts/verify-goldens.mjs`; determinism, spec-lint, and hygiene all pass
      unmasked with `echo $?`.
- [ ] Commit message: `perf: lazy session discovery + incremental summary cache (fixes #13)`.
