---
id: SPEC-0056
title: "aireceipts backfill — bulk retroactive receipts for sessions you already ran"
status: shipped
milestone: M5
depends: [SPEC-0001, SPEC-0018, SPEC-0043, SPEC-0045]
---

# SPEC-0056: `aireceipts backfill` — bulk retroactive receipts

## Purpose

Someone installs `aireceipts` today after weeks of agent use. Per-session receipts for
old sessions already work (`aireceipts --list` + `aireceipts <selector>`, one at a time),
and `aireceipts week` only ever looks at a trailing 7-day window
(`windowBounds`, `src/aggregate/week.ts`) even when `--since` is passed. There is no way
to sweep an entire existing history in one command. `backfill` is that sweep: it walks
every discovered session (across every adapter, SPEC-0010) and either prints a
deterministic summary or, with `--out`, writes one receipt file per session plus a
manifest — turning "I have weeks of untouched history" into "one command, done."

Serves I1 (deterministic; the sweep and every file it writes are a pure function of the
sessions on disk — re-running against an unchanged `--out` dir reproduces byte-identical
files), I2 (a session with no priced row still counts — the summary's dollar figure is a
priced-subset total, never a number blended with token-only sessions), I3 (every count in
the summary is directly attributable to sessions the sweep actually saw or actually
failed to load — SPEC-0045's no-silent-drop discipline), and I5 (each per-session file is
`renderReceipt(buildReceiptModel(session)) + "\n"` — the same renderer bytes plus trailing
newline `aireceipts <selector>` writes, so with colour off and no budget configured a
backfilled file matches that selector's stdout byte-for-byte).

**Not to be confused with** the rejected `specs/SPEC-0046-pr-backfill.md` — that spec was
a different, unrelated idea (`pr --pr <N>`, attaching a receipt to an already-merged
GitHub PR after the fact). This spec is a bulk **local session-history** sweep with no
GitHub/PR involvement at all; the shared word "backfill" is coincidental.

## Requirements

- **R1 — A new `backfill` subcommand.** `aireceipts backfill [--since <date>] [--limit N]
  [--out <dir>] [--json]`, registered as a self-contained command
  (`src/cli/commands/backfill.ts`, SPEC-0018) with `matches: (o) => o.positional[0] ===
  "backfill"`, at an unclaimed priority between `list` (50) and `pr` (60). The parser
  (`src/cli/options.ts`) gains two value-consuming flags in both `--flag value` and
  `--flag=value` forms: `--limit` (new `limit` field) and `--out` (new `outDir` field —
  distinct from `output`, which SVG/PNG's `-o`/`--output` already owns).
- **R2 — No `--out`: summary only, never writes a file.** Without `--out`, `backfill`
  prints a deterministic plain-text (or, with `--json`, a JSON) summary of what a sweep
  *would* do — total sessions seen, how many matched the filters, how many discovery
  already knows are unreadable — and writes nothing to disk. A dry run never parses
  transcripts (the bare command stays instant on a multi-thousand-session machine), so
  its failure figure is a *known-unreadable lower bound*: the text summary labels it
  `Known unreadable`, never `Load failures` — a number the run didn't measure is never
  claimed (I3). `--out` is the only way to produce files; a dry summary can always be
  requested for free.
- **R3 — `--out <dir>`: one receipt per session plus a manifest.** With `--out`, every
  matched, successfully-loaded session is rendered through the same pipeline
  `aireceipts <selector>` uses (`loadSession` → `buildReceiptModel` → `renderReceipt`) and
  written (colour off, content `renderReceipt(model) + "\n"`) to
  `<dir>/<seq>-<source>-<slug>.txt`, newest-first (the same ordering `--list` uses),
  `seq` zero-padded to the width of the total matched count. `slug` is a filesystem-safe
  derivative of the session id — `SessionSummary.id` can be an absolute file path for
  file-based adapters (`src/parse/types.ts`), so the raw id never lands in a path
  component: take the id's basename, replace every character outside `[A-Za-z0-9._-]`
  with `-`, and truncate to 40 characters. Uniqueness is guaranteed by the `seq` prefix,
  not the slug. A single `<dir>/index.txt` manifest opens with the fixed marker line
  `# aireceipts backfill manifest v1` and then lists every written file in the same
  order, one line each, built only from session-derived facts (no wall-clock generation
  timestamp) so it is byte-identical across reruns. When the filters match zero
  sessions, `--out` writes nothing at all — no directory, no manifest — and the summary
  says so.
- **R4 — Refuse to clobber.** If `--out` names a directory that already exists, is
  non-empty, and does not contain an `index.txt` whose first line is the R3 marker
  (`# aireceipts backfill manifest v1`), the command refuses to write anything, prints an
  explanation, and exits 1. Only a directory carrying a marker-bearing manifest — proof
  the directory belongs to a prior backfill — is treated as safe to overwrite (the common
  re-run case); a stray, unrelated `index.txt` does not unlock overwriting.
- **R5 — Deterministic re-run (I1).** Given an unchanged set of sessions on disk, running
  the identical `backfill --out <dir>` command twice produces byte-identical files the
  second time (same names, same bytes, same manifest) — the sweep is a pure function of
  what is currently discoverable, not of when it is run.
- **R6 — `--since` / `--limit` filters.** `--since <date>` parses the same way `week`'s
  `--since` does (`Date.parse`, reject `NaN` with exit 1) and drops sessions that ended
  before that instant. `--limit N` caps the matched set to the `N` most recent sessions
  after the `--since` filter; `N` must be a positive integer — anything else (zero,
  negative, fractional, non-numeric) exits 1 with an error and writes nothing. Both
  flags are optional and compose.
- **R7 — Honest counting, never a silent drop (SPEC-0045).** Session discovery calls
  `listFullSessions(undefined, { includeDegraded: true })` (the PR-flow convention) so a
  degraded/unreadable session is still counted rather than invisibly excluded. On an
  `--out` run (the only mode that loads transcripts), any session whose `loadSession`
  returns `null` is counted as an explicit load failure in the summary — never merged
  into the written count, never dropped without a trace. On a dry run no load is
  attempted and the count covers exactly the degraded summaries (R2's labelled lower
  bound).
- **R8 — `--json` summary, versioned.** A hand-built, fixed-key-order object opening
  with `schemaVersion` (the existing `SCHEMA_VERSION`), validated by a new
  `backfillJsonSchema` in `src/receipt/exportSchema.ts` that joins the
  `allExportFieldNames()` union, with every field documented field-by-field in
  `docs/json-schema.md` inside the `json-fields` markers (the automated parity test
  then gates it like every other export surface — deliberately NOT repeating `week
  --json`'s unversioned-gap precedent, which `docs/json-schema.md` records as debt to
  fix, not a pattern to copy). The object carries the same counts as the text summary
  plus a per-matched-session manifest array (source, session id, title, start time,
  the file name written or `null`, and a load-failed flag). `--json` and `--out`
  compose — the summary always reflects what the run did or would do.
- **R9 — Feature telemetry (SPEC-0043).** `"backfill"` joins `COMMAND_VALUES` (so the
  automatic `cli_run` event classifies it) and `EXPORT_SURFACE_VALUES`; `"text"` joins
  `EXPORT_FORMAT_VALUES` (no existing export format value covers a plain-text file write).
  `export_generated` fires at most once per invocation: `{surface: "backfill", format:
  "json", wroteFile: false, result: "success"}` for a `--json`-only summary; `{surface:
  "backfill", format: "text", wroteFile: true, result: "success"}` when `--out` wrote
  files; `{surface: "backfill", format: "text", wroteFile: false, result: "invalid_args"}`
  on the refuse-to-clobber path; nothing at all for a bare summary (no `--out`, no
  `--json`) or when zero sessions match, mirroring `list`/`week`. `docs/telemetry.md` is
  updated for parity in every enum list touched.
- **R10 — Documented.** A short section is added to `docs/guide/01-getting-started.md`
  ("Already have sessions? `aireceipts` works retroactively") rather than a new page, and
  a `help` entry is added to the command.

## Scenarios

- **Given** a machine with existing Claude Code and Codex sessions and no `--out`,
  **When** `aireceipts backfill` runs, **Then** stdout shows a summary of session counts
  and zero files are written.
- **Given** the same machine, **When** `aireceipts backfill --out ./receipts` runs,
  **Then** `./receipts/` gains one `.txt` file per session plus `index.txt`, and running
  the identical command again produces byte-identical files.
- **Given** `./receipts/` already has unrelated files and no `index.txt`, **When**
  `aireceipts backfill --out ./receipts` runs, **Then** it exits 1, writes nothing, and
  explains why.
- **Given** `./receipts/` holds a prior backfill's `index.txt`, **When** `backfill --out
  ./receipts` runs again, **Then** it overwrites (no refusal).
- **Given** `--since 2026-01-01 --limit 5`, **When** `backfill` runs, **Then** only the 5
  most recent sessions ending on/after that date are matched.
- **Given** one session in the discovered set is `degraded: "unreadable"` and another's
  `loadSession` returns `null`, **When** `backfill --out <dir>` runs, **Then** the
  summary's load-failure count reflects both — neither is silently absent from any
  count.
- **Given** the same degraded session and no `--out`, **When** `backfill` runs, **Then**
  no transcript is loaded, the summary labels the figure `Known unreadable`, and it
  counts exactly the degraded summary.
- **Given** `--out <dir>` and filters that match zero sessions, **When** `backfill`
  runs, **Then** nothing is written (no directory, no manifest), the summary says so,
  and no `export_generated` event fires.
- **Given** zero sessions are discovered, **When** `backfill` runs (with or without
  `--out`/`--json`), **Then** it prints the same "no sessions found" family of message as
  `--list`, exits 0, writes nothing, and fires no `export_generated` event.
- **Given** `--json` with no `--out`, **When** `backfill` runs, **Then** stdout is a
  single JSON object with a fixed key order and an `export_generated` event with `format:
  "json", wroteFile: false` fires.

## Non-goals

- **A `--force` flag to clobber a non-empty, non-backfill directory.** The refuse-to-
  clobber check (R4) is the whole safety story for v1; a user who wants to overwrite an
  unrelated directory can pick an empty one. Revisit if requested.
- **Per-session SVG/PNG/CSV export.** `backfill` writes the plain-text receipt only;
  `aireceipts <selector> --svg`/`--csv` already cover those surfaces one session at a
  time. Adding every export format to the bulk path multiplies surface area for a sweep
  whose job is "get me all my history quickly," not "get me every format."
- **`--agent`/`--project` filtering.** Only `--since`/`--limit` ship now; scoping by
  agent or project is a natural follow-up but not required to satisfy "generate receipts
  for sessions I already ran."
- **A watch/cron mode that re-runs automatically.** `backfill` is a one-shot sweep; SPEC-
  0006 already owns the session-end hook for ongoing capture.
- **Any relationship to `specs/SPEC-0046-pr-backfill.md`.** That spec (rejected) covers
  attaching a receipt to an already-merged GitHub PR via `pr --pr <N>` — an unrelated
  mechanism this spec does not touch, extend, or supersede.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 registered | `aireceipts backfill` | `selectCommand` picks the backfill command; priority between 50 and 60 |
| R1 help | `--help` | help output lists `backfill` |
| R2 summary only | `backfill` (no `--out`) | stdout summary; no files written |
| R2 json summary | `backfill --json` (no `--out`) | stdout is one JSON object; no files written |
| R3 writes files | `backfill --out <dir>` | `<dir>` gains `<seq>-<source>-<slug>.txt` per matched session + `index.txt`; each `.txt` equals `renderReceipt(buildReceiptModel(session)) + "\n"` |
| R3 slug safety | a session whose id is an absolute file path | filename contains no path separators; slug is basename-derived, `[A-Za-z0-9._-]` only, ≤ 40 chars |
| R3 manifest marker | any successful `--out` run | `index.txt` first line is `# aireceipts backfill manifest v1` |
| R3 ordering | multiple sessions | file `seq` numbers and `index.txt` order match `--list`'s newest-first order |
| R4 refuse clobber | non-empty `<dir>` lacking a marker-bearing `index.txt` | exit 1; nothing written; explanatory message |
| R4 stray index.txt | non-empty `<dir>` with an `index.txt` lacking the marker line | exit 1; nothing written |
| R4 allow rerun | `<dir>` contains a prior marker-bearing `index.txt` | writes proceed, no refusal |
| R5 determinism | `backfill --out <dir>` run twice, unchanged sessions | second run's files are byte-identical to the first |
| R6 since filter | `--since <date>` | sessions ending before that instant excluded |
| R6 since invalid | `--since not-a-date` | exit 1, error message, nothing written |
| R6 limit | `--limit N` | at most `N` most-recent matched sessions written |
| R6 limit invalid | `--limit 0`, `--limit -3`, `--limit 2.5`, `--limit abc` | exit 1, error message, nothing written |
| R7 degraded counted | one `degraded: "unreadable"` summary in the discovered set | summary's failure count includes it (both modes) |
| R7 load-null counted | `--out` run; `loadSession` resolves `null` for a summary | summary's load-failure count includes it; that session is skipped, not silently dropped |
| R7 dry run never loads | `backfill` (no `--out`) | `loadSession` is never called; summary labels the figure `Known unreadable` |
| R3 zero-match --out | `--out <dir>` + filters matching zero sessions | nothing written (no dir, no manifest); summary says so; no `export_generated` |
| R8 json shape | `--json` | fixed key order; `schemaVersion` first; output parses under `backfillJsonSchema` |
| R8 doc parity | `docs/json-schema.md` vs `backfillJsonSchema` | the existing parity test passes with the new fields documented |
| R9 telemetry enum | `COMMAND_VALUES`, `EXPORT_SURFACE_VALUES`, `EXPORT_FORMAT_VALUES` | each includes the new `"backfill"`/`"text"` value |
| R9 export event (json) | `backfill --json`, no `--out` | one `export_generated` with `format: "json", wroteFile: false, result: "success"` |
| R9 export event (out) | `backfill --out <dir>` | one `export_generated` with `format: "text", wroteFile: true, result: "success"` |
| R9 export event (clobber) | refuse-to-clobber path | one `export_generated` with `wroteFile: false, result: "invalid_args"` |
| R9 export event (none) | `backfill` bare, or zero sessions | no `export_generated` fired |
| R9 docs parity | `docs/telemetry.md` | enum lists touched by R9 mention `backfill`/`text` |
| R10 docs | `docs/guide/01-getting-started.md` | names `backfill` as the retroactive path |

## Success criteria

- [x] `aireceipts backfill` prints a deterministic summary with zero sessions on disk and
      with a real history, and writes files only when `--out` is given.
- [x] `--out` produces one byte-stable receipt per session (I5) plus a deterministic
      `index.txt`; a second identical run reproduces the same bytes (I1).
- [x] The refuse-to-clobber check protects a non-empty, non-backfill directory.
- [x] `--since`/`--limit` filter correctly and compose; degraded/unreadable/load-failed
      sessions are counted, never silently dropped (SPEC-0045).
- [x] `backfill` is a valid telemetry command; `export_generated` fires exactly per the
      decision tree in R9; `docs/telemetry.md` stays in parity.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass unmasked
      (`echo $?`).

## Validation

**2026-07-05 · S1 (self):** every seam checked against the code rather than assumed.
Command registration needs no shared-file edit (`src/cli/registry.ts` globs
`src/cli/commands/`); the current priority ladder has a free slot between `list.ts`
(priority 50) and `pr.ts` (priority 60), confirmed by reading every command file's
`priority`/`matches`. `listFullSessions(undefined, { includeDegraded: true })`
(`src/parse/load.ts:27-51`) is the exact call the PR flow already makes for honest
counting; `loadSession` (`src/parse/load.ts:68-70`) returning `null` is the load-failure
signal SPEC-0045 requires be counted, not dropped. The per-session write chain —
`loadSession(summary)` → `buildReceiptModel(session)` (`src/receipt/model.ts:200`) →
`renderReceipt(model)` (`src/receipt/render.ts:128-130`) — is the identical chain
`receipt.ts`/`compare.ts`/`handoff.ts`/the PR flow already use, so I5 renderer-byte
identity holds by construction, not by re-implementation. `cli_run` needs
no code in `backfill.ts` at all: `src/cli/index.ts:35-44` fires it automatically off
`command.name` for every command once `"backfill"` joins `COMMAND_VALUES`
(`src/telemetry/helpers.ts:46`'s `toCommandTelemetry` silently drops unknown names, which
is exactly why the enum addition is load-bearing). `week.ts`'s own output is
tested with plain vitest string assertions (`test/receipt/week.test.ts`), not the
`goldens/`-directory/`scripts/verify-goldens.mjs` mechanism (no `week` golden fixture
exists) — `backfill`'s summary render follows the same non-golden testing convention;
the per-session `.txt` content is already golden-gated, transitively, via the
existing per-template goldens `buildReceiptModel`/`renderReceipt` are gated by.

**2026-07-05 · S2 (Codex, read-only): REWORK → applied.** Five findings, all accepted:
(1) BLOCKER — `SessionSummary.id` can be an absolute file path
(`src/parse/types.ts:99-102`), so `<id>` in a filename would embed path separators; R3
now derives a sanitized, truncated basename slug and leans on the `seq` prefix for
uniqueness. (2) BLOCKER — a bare `index.txt` cannot prove a directory belongs to
backfill; R3/R4 now define a fixed manifest marker line and the clobber guard requires
it. (3) HIGH — an unversioned `--json` copied `week --json`'s documented *gap* as if it
were precedent; R8 now mandates a versioned `backfillJsonSchema` in
`src/receipt/exportSchema.ts`, joined to `allExportFieldNames()` and doc-parity-gated.
(4) HIGH — byte-identity with `aireceipts <selector>` was false when budget lines are
configured (`src/cli/commands/receipt.ts:106-128` appends budget output) and omitted the
trailing newline; Purpose/R3 now pin `renderReceipt(model) + "\n"` (colour off) and
qualify the selector claim with "no budget configured". (5) MEDIUM — `--out`/`--limit`
had no parser representation; R1 now names the new `limit`/`outDir` `CliOptions` fields
(avoiding the SVG/PNG-owned `output`) and R6 pins positive-integer validation with an
invalid-value test row. Non-blocking confirmations: registry discovery and the 50-60
priority gap hold; `includeDegraded: true` is the right seam for honest counting.

**2026-07-05 · S2b (Codex, read-only, deep — implementation review): REWORK → applied.**
Three findings on the built diff: (1) HIGH — the dry summary printed `Load failures: 0`
without ever attempting a load, so a would-fail session read as healthy. Codex's
proposed fix (load every matched session on dry runs) was **rejected on cost** — that
turns the instant bare command into a full parse of the entire history (thousands of
transcripts) — and the honesty gap closed the other way instead: R2/R7 now define the
dry figure as a *known-unreadable lower bound*, the text summary labels it `Known
unreadable` (never `Load failures`, which only an `--out` run may print), and a test
pins that dry runs never call `loadSession`. (2) MEDIUM — `--out` with filters matching
zero sessions still wrote a manifest and fired `export_generated`/`first_export`,
contradicting R9's zero-match silence; the zero-match `--out` run now writes nothing
(no directory, no manifest), says so in the summary, and fires nothing (R3 amended).
(3) LOW — the I5 test asserted exact renderer bytes for only the first written receipt;
it now asserts every written file, and new tests cover the two paths above.
Non-blocking confirmations: `SCHEMA_VERSION` hoist minimal and correct; help golden
deliberate and byte-matched; no product-path network; no fabricated dollars; no ranking
language; slug/marker/clobber/newest-first all in scope.

**2026-07-05 · approved (button 1):** maintainer directive, in-session — GTM readiness:
add support to generate receipts for already-existing sessions for people who install
`aireceipts` after already having run sessions. S3 value gate: this is the direct answer
to "I just installed this after weeks of agent use — now what?", the exact gap between
per-session receipts (already work) and a 7-day-capped `week` (cannot reach back further);
surface area is one new command reusing the existing render/telemetry/discovery seams
end-to-end, no new pricing or parsing logic.
