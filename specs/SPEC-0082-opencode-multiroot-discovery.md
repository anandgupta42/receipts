---
id: SPEC-0082
title: "Make opencode multi-root discovery complete and bounded"
status: building
milestone: M5
depends: [SPEC-0010]
---

# SPEC-0082: Make opencode multi-root discovery complete and bounded

Invariants: **I1** (read-only local discovery, deterministic ordering, no network or
model call), **I2/I3** (no pricing behavior changes; newly reachable sessions still
pass the existing evidence and pricing gates), **I4** (no path, database, or session
content enters telemetry), **I5** (existing receipts stay byte-identical for the same
selected transcript), **I6** (source discovery adds no ranking).

Research source:
[`docs/internal/research/2026-07-12-deterministic-session-review.md`](../docs/internal/research/2026-07-12-deterministic-session-review.md).

## Purpose

The opencode adapter currently chooses one data root and considers only top-level files
whose basename starts with `opencode` (`src/parse/opencode.ts:661-688`). The shipped
default root exposes one session. The final dated inventory of a second local app root
found 4,081 root sessions across 20 databases, but the existing loader returned only
3,233 full summaries: 19 prefixed databases are considered, while a non-prefixed
compatible database with 675 roots returns zero because `summarySql()` selects optional
session columns it does not carry.

Add explicit multi-root discovery, qualify top-level `.db` files by the columns the
adapter actually reads, and make optional session columns safe. The upstream default
root remains unchanged; users opt into additional roots. This is the prerequisite for
representative session-review coverage—no finding can serve a session the adapter never
lists.

**Kill criterion:** reject the increment if the dated dogfood run cannot return at
least 3,900 source-qualified summaries (including at least 600 from the non-prefixed
compatible database), admits any unsupported same-table-name fixture, changes the
default-root selection without explicit configuration, or exceeds 8 seconds wall time
or 512 MiB maximum RSS on the measured machine. Dated row counts are evidence, not a
mutable CI oracle.

## Requirements

- **R1 — Explicit deterministic roots.** A new `OPENCODE_DATA_DIRS` environment
  variable accepts a platform-delimiter-separated list; a constructor-only `roots`
  option supports fixtures. Resolution order is: constructor `roots` when non-empty;
  constructor `root`; non-empty `OPENCODE_DATA_DIRS`; existing
  `OPENCODE_DATA_DIR`; existing platform default. Empty entries are ignored; roots are
  resolved absolute, deduplicated by normalized path (not filesystem identity), and
  sorted. The shipped default remains one upstream root. POSIX `:` and Windows `;`
  parsing are unit-tested independent of the host platform. Missing, unreadable, or
  non-directory roots contribute no candidates and do not abort readable siblings.
- **R2 — Column-qualified candidates.** Each selected root contributes non-symlink
  top-level regular files ending in `.db`, regardless of basename. Qualification uses
  read-only `PRAGMA table_info`. `session` requires `id`, `time_created`, and
  `time_updated`. The `session_message` branch requires `id`, `session_id`, `type`,
  `seq`, `time_created`, `time_updated`, and `data`. The other branch requires
  `message(id, session_id, time_created, time_updated, data)` and
  `part(id, message_id, session_id, time_created, data)`. Same-table-name/wrong-column,
  unrelated, corrupt, locked, and unsupported files are skipped. Discovery never
  mutates, repairs, or journals a database. It never descends into child directories.
- **R3 — Optional session columns.** Both summary queries and the row mapper treat
  session-level `title`, `model`, `version`, `directory`, `path`, and aggregate token
  columns as optional. Absent text fields become `NULL`; absent numeric aggregates
  become `0`; message-level evidence remains the source for model and token totals. No
  absent optional column may abort the whole database. Current `session_message` and
  `message`+`part` fixtures both flow through their existing loaders after
  qualification.
- **R4 — Stable identity and ordering.** The same normalized absolute database reached
  from duplicate lexical roots is opened once. Database paths sort lexicographically;
  each database retains the existing session order (`src/parse/opencode.ts:711-738`).
  Equal vendor session IDs in different databases remain two `dbPath + sessionId`
  identities. Symlink-alias roots are not filesystem-deduplicated and the spec makes no
  stronger claim.
- **R5 — Forced database compatibility.** The forced-database winner remains constructor
  `dbPath`, then `OPENCODE_DB_PATH`, then `OPENCODE_DB`; exactly one named database is
  inspected and it still passes R2 qualification. A relative forced path resolves
  against constructor `root`, then `OPENCODE_DATA_DIR`, then the existing default—the
  current single-root rule. Constructor `roots` and `OPENCODE_DATA_DIRS` are ignored
  when a forced database wins. `:memory:` remains literal and no suffix check is added
  to a forced path.
- **R6 — Bounded enumeration and review.** Measured database passes took 5.45–6.5
  seconds, and the loader pass used about 398 MiB maximum RSS for 3,233 summaries. With
  the explicitly configured roots and
  compatible non-prefixed database enabled, both a fresh-process run and its immediate
  in-process repeat of `listFullSessions("opencode")` return at least 3,900 summaries in
  at most 8 seconds and 512 MiB maximum RSS on the same machine. Let `C` be normalized
  top-level `.db`
  candidates and `S` returned sessions: instrumented fixtures cap one enumeration at
  `12C + 10S + 1` SQL statements, one open per candidate, and one body load per full
  session. The recent-window review path partitions lazy summaries before body loads,
  reuses its already-loaded selected session by composite ID, and loads no session body
  more than once in one command invocation. The measurement command is
  `node scripts/measure-opencode-discovery.mjs --runs=2 --json`: “fresh” means the first
  adapter call in a new Node process with an empty temporary aireceipts cache; it does
  not claim to evict the operating-system page cache. The script normalizes
  `process.resourceUsage().maxRSS` to MiB and writes no path, session ID, title, prompt,
  or command content.
- **R7 — Selection and diagnostics.** Without explicit multi-root configuration, the
  newest/no-selector result, numeric selectors, cwd-scoped discovery, and aggregate
  windows are byte/identity-compatible with current main. With multiple roots, global
  sort remains `sortMostRecentFirst`; timestamp ties preserve deterministic input order
  (database path, then the adapter's existing session order). `rootsHint()` in
  `src/parse/load.ts:113-118` flattens every adapter root, deduplicates it in order, and
  the no-data diagnostic names every root actually searched.
- **R8 — Semantics and docs.** This spec adds no new usage, provider, tool, task,
  dollar, or review interpretation; the same explicitly selected session produces
  byte-identical text/JSON. A test-only eager reference and the optimized lazy recent
  path must produce identical window membership, aggregates, standing-rule suggestions,
  and final review/legacy-alias bytes for a multi-session fixture spanning both window boundaries,
  the recurrence threshold, unreadable summaries, and null body loads. The
  `docs/agents/opencode.md` and troubleshooting pages document
  `OPENCODE_DATA_DIRS`, existing overrides, schema/column qualification, resource
  implications, and the top-level/no-recursion boundary. No path or database metadata
  enters telemetry. Dated dogfood output is recorded at
  `docs/internal/research/measurements/opencode-discovery-2026-07-12.json` with baseline
  SHA, Node/OS/architecture, root/candidate/session counts, both wall times, and peak
  RSS—but no local identifier or content field.

## Scenarios

- **Given** two explicitly configured roots, **when** sessions are listed, **then**
  qualified databases from both are reachable in stable global order while the same
  installation without that configuration keeps its current default selection.
- **Given** a compatible database named `sessions.db` whose `session` table omits the
  R3 optional columns, **when** its root is scanned, **then** it is accepted and
  message-level facts populate summaries.
- **Given** same-table-name/wrong-column SQLite, corrupt `.db`, a symlinked `.db`, and a
  nested compatible database, **when** discovery runs, **then** all four are skipped
  without error and without writes.
- **Given** the same root twice through `OPENCODE_DATA_DIRS`, **when** discovery runs,
  **then** its database and sessions appear once.
- **Given** `OPENCODE_DB_PATH`, **when** sibling compatible databases exist, **then**
  only the forced database is inspected.
- **Given** an existing standard-root fixture, **when** default, numeric, cwd, and
  explicitly selected paths run before and after this change, **then** identities and
  receipt/review bytes are unchanged.

## Non-goals

- **New issue semantics.** Additional deterministic issue detectors and prevention
  recommendations belong to SPEC-0083's session-review registry. Work-resumption facts
  such as plans, interruptions, and pending tasks are a separate possible feature and
  are not session-review output under the maintainer's clarified definition.
- **Recursive database search.** It is slow, surprising, and risks reading unrelated
  application data; explicit roots plus top-level schema qualification cover the
  measured corpus.
- **Arbitrary SQLite ingestion.** Table-shape qualification is mandatory; a `.db`
  suffix alone never makes a file a session source.
- **Merging equal session IDs across databases.** Without a content identity proof,
  deduplication would silently drop evidence.
- **Writing config or migrating databases.** Overrides remain environment/constructor
  inputs and every database is opened read-only.
- **Automatic second default root.** It expands implicit machine state and changes
  selection semantics; this increment requires explicit multi-root configuration.
- **Filesystem-identity deduplication.** Resolving symlink aliases can add I/O and
  platform differences; only normalized lexical duplicates are removed.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 default | no new env/constructor input | existing one-root behavior and selection |
| R1 env list | POSIX/Windows list with empty + lexical duplicate entries | exact configured roots, absolute/deduped/sorted |
| R1 precedence | roots, root, list env, legacy env all present in combinations | R1 winner, including empty-list fallback |
| R1 unavailable root | missing/unreadable/file root plus readable sibling | bad root skipped; sibling still listed |
| R2 arbitrary basename | compatible `sessions.db` | discovered and parsed |
| R2 false-shape | required table names, wrong/missing columns | rejected |
| R2 rejection | unrelated/corrupt/locked, nested, symlinked `.db` | skipped, no writes or thrown discovery error |
| R3 optional fields | either branch + session without R3 optional columns | summary from message evidence, no database-wide drop |
| R3 schema variants | `session_message` and `message`+`part` fixtures | both accepted through existing loaders |
| R4 duplicate root | same normalized absolute root twice | DB opened and sessions emitted once |
| R4 alias + duplicate session ID | symlink-alias roots; two different DBs with equal vendor ID | alias limitation explicit; source-qualified summaries retained |
| R5 forced precedence | constructor/env DB inputs plus roots/siblings | current winner only; relative and `:memory:` behavior pinned |
| R6 resource gate | fresh + repeat dated configured dogfood roots | each ≥3,900 summaries, ≤8s, ≤512 MiB |
| R6 operation bound | instrumented `C`-database/`S`-session fixtures | SQL ≤`12C + 10S + 1`; one open/body load |
| R6 review reuse | selected session inside recent window | lazy partition; selected/body loaded once |
| R6 harness | fresh process + immediate repeat | sanitized dated JSON with timings/RSS and machine metadata |
| R7 selectors | default/no-selector, numeric, cwd, equal-timestamp multi-root | default compatible; multi-root globally stable |
| R7 diagnostics | multi-root empty state | every searched root appears once |
| R8 byte parity | same explicitly selected fixture | identical receipt, JSON, and review/legacy-alias bytes |
| R8 recent parity | multi-session boundary/threshold/unreadable/null corpus | eager oracle = lazy membership, suggestions, bytes |
| R8 docs | agent page + troubleshooting | overrides, qualification, resources, no-recursion documented |

## Success criteria

- [ ] Explicit configured roots return at least 3,900 dogfood summaries within the R6
      resource budget; the non-prefixed compatible database contributes at least
      600 instead of zero.
- [ ] Cold and immediate-repeat enumeration meet the same bound; instrumented SQL,
      database-open, and review body-load counts meet R6.
- [ ] Required-column fixtures admit both supported branches and reject every
      same-table-name/wrong-column negative.
- [ ] Existing standard-root and forced-database fixtures retain byte-identical output.
- [ ] The eager-reference/lazy-path regression proves identical recent-window inputs,
      aggregates, suggestions, and review bytes across R8's adversarial corpus.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, and `node scripts/hygiene.mjs` pass unmasked
      (`echo $?`).

## Validation

**2026-07-12 · S1 (self):** the first draft bundled explicit multi-root support with an
automatic second default, qualified candidates by table names alone, and used mutable
exact local counts as acceptance criteria. Reworked to keep the shipped default
unchanged, require explicit configuration, qualify exact required columns, treat dated
counts only as dogfood lower bounds, preserve lexical/symlink limits honestly, pin
forced-input precedence and selection behavior, and enforce I1–I6 with byte-parity and
no-telemetry-content tests.

**2026-07-12 · S2 (independent code/value review): REWORK → APPROVE.** Accepted every
finding: added fresh/repeat time and RSS gates; bounded SQL, database opens, and body
loads; added eager-vs-lazy recent-window parity for boundary, threshold, unreadable,
and null-load cases; replaced table-only checks with explicit columns and false-shape
fixtures; moved mutable counts to dated evidence; included all roots in diagnostics;
pinned default/numeric/cwd/tie selection; made forced-input precedence and relative
resolution explicit; documented lexical rather than filesystem identity; and cut the
automatic alternate default. The final re-review reported no remaining blocker.

**2026-07-12 · S3 (worth):** **Who + how often:** every explicitly configured
multi-root list, aggregate, and session review; on the maintainer's dated corpus, the normal
default exposed one database-root session while 4,081 roots existed in the alternate
store. A single-root override returned 3,233 summaries, but the 675-root non-prefixed
database still returned zero. **Do nothing:** combined-corpus review evaluation remains
impossible and repeated root switching cannot produce one deterministic aggregate.
**Smaller fix:** documentation/forced DB alone cannot combine stores and does not repair
the measured optional-column failure; schema-only or roots-only fixes each leave half
the defect. **Steelman:** the upstream default is already supported, the alternate store
is opt-in, full enumeration approaches 400 MiB, and issue-registry development could use
the 3,233 already reachable summaries. **Counter:** this task explicitly requires using
the full local multi-vendor corpus; opt-in discovery plus the R6 kill gate contains the
cost and makes the later coverage verdict representative. **Verdict: build now after
maintainer approval**, then keep the direct issue registry as the next separate increment.

**2026-07-12 · S4 (lint):** pass.
