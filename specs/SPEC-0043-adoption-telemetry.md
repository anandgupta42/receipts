---
id: SPEC-0043
title: "Adoption telemetry v2 — feature events, activation milestones, install identity, receipts counter"
status: building
milestone: M4
depends: [SPEC-0002, SPEC-0018]
---

# SPEC-0043 · Adoption telemetry v2 (amends SPEC-0002)

## Purpose

Founder decision 2026-07-04: aireceipts needs to know **which features are actually
adopted** — per-command usage, activation, return usage, and fleet receipt volume — not
just whether the CLI crashes. SPEC-0002 deliberately minimized `cli_run` to be "useless
as usage analytics" and deferred a persistent install ID; this spec explicitly reverses
both decisions, on the same rails and under the same field discipline. What was
anonymous-and-unlinked becomes **pseudonymous at the install level**: a random,
disclosed, resettable identifier links events to an *install*; no field identifies a
person, machine, or repo. Disclosure (notice, docs, README) moves in the same release.
Research basis: three-stream survey of devtool telemetry practice (Next.js / Astro /
Turborepo / Gatsby / Homebrew field catalogs, backlash forensics, PLG metrics),
maintainer's archive; the surveyed norm — random-UUID install identity, enum/bucket-only
fields, first-party sink, loud opt-out — is exactly what the SPEC-0002 rails support.

Invariants: I1 (zero network in the product path — telemetry stays fail-safe, bounded,
out-of-band), I4 (amended by this spec: anonymous diagnostics **plus pseudonymous
feature-adoption** telemetry, disclosed and escapable), I5 (receipt bytes untouched —
no counter in any golden-gated output). SPEC-0000's telemetry sentences and AGENTS.md
I4 are amended by this spec's implementation (SPEC-0000 outranks specs when they
disagree — the amendment must land there, not only here).

## Requirements

- **R1 — Event catalog v2, exactly nine names.** `EVENT_NAMES` becomes {`cli_run`,
  `cli_error`, `parse_failure`, `receipt_generated`, `export_generated`,
  `pr_flow_completed`, `hook_configured`, `integration_surface_rendered`,
  `activation_milestone`}. `cli_error` and `parse_failure` are unchanged. The
  exhaustive-name test moves from "exactly three" to this closed set. Every new schema
  follows SPEC-0002 R3 verbatim: `.strict()` zod, enum/bucket/boolean/bounded-hash
  fields only, no free text anywhere, invalid events dropped not sanitized.
- **R2 — `cli_run` widened.** `commandClass` becomes the full registry command enum —
  the 17 existing names under `src/cli/commands/` plus R7's new `stats`, 18 total; the
  {receipt, compare, other} collapse made per-feature adoption invisible. The
  command-inventory and commandClass tests are updated to pin the 18-name set. Adds:
  `isCI` boolean (from `CI`/`GITHUB_ACTIONS` env presence — separates humans from
  pipelines), `installHash` (R6, or the literal `"unavailable"`), `runOrdinalBucket`
  (bucketed lifetime run count from R7 state: `1|2-3|4-10|11-50|>50|unavailable`).
- **R3 — `receipt_generated` + the counter definition.** A *receipt* is a rendered
  session cost receipt: the `receipt` command (any output mode), `compare`, `mini`, and
  the `pr` body render. Statusline/quota renders and the `templates` fixture preview are
  **not** receipts (statusline would flood; preview is fake data). Fields: `surface`
  {receipt, compare, mini, pr}, `agentType` (existing enum), `multiAgent` boolean,
  `outputMode` {text, json, csv, svg, png, markdown}, `template` (`TEMPLATE_NAMES`,
  `src/receipt/blocks.ts:20`, or `none`), `pricedRowCoverage` {none, some, all} — the
  share of rendered tool rows whose `priced` flag is set (`src/pricing/attribution.ts:44`;
  `none` when `totalUsd` is null, `all` when every row priced, else `some`),
  `hasStuckLoopWaste`/`hasTrivialSpansWaste`/`hasContextThrashWaste` booleans (the three
  `WasteLine.kind`s, `src/receipt/model.ts:31-57`), `hasPriceDelta` boolean,
  `turnCountBucket`/`toolCallCountBucket` (countBucket: `0|1|2-3|4-10|11-50|>50`),
  `receiptOrdinalBucket` (bucketed lifetime receipt count, same values as R2's
  `runOrdinalBucket` — never the raw count).
- **R4 — Feature-detail events.** `export_generated` {surface {receipt, compare, week,
  list, pr}, format {json, csv_session, csv_tool, svg, png, markdown, html}, wroteFile
  boolean, result}; `pr_flow_completed` {mode {dry_run, post},
  artifactRequested/shareRequested booleans, contributorCountBucket,
  commentResult/artifactResult/shareResult {success, failed, skipped}, result};
  `hook_configured` {operation {install, uninstall}, promptOutcome {accepted, declined,
  not_prompted}, result}; `integration_surface_rendered` {integration {statusline,
  quota}, inputMode {stdin_payload, disk_fallback, none}, payloadValid boolean, result}
  — `mini` is a receipt surface (R3), never double-counted here.
  Shared `result` enum: {success, no_data, invalid_args, declined, external_missing,
  external_failed, write_failed, internal_error}. Week/handoff/budget/benchmark get
  **no** detail events — R2's widened command enum already measures their adoption; add
  depth only when a concrete decision needs it.
- **R5 — `activation_milestone`.** Fired at most once per milestone per install
  (booleans in R7 state): {first_run, first_receipt, third_receipt, tenth_receipt,
  first_export, first_compare, first_week, first_hook_install, first_pr, first_pr_post,
  first_artifact}. Fields: `milestone`, `command` (R2 enum), `installAgeBucket`
  {first_day, 2-7d, 8-30d, 31-90d, >90d, unavailable} (derived from R7's local
  `firstRunAt`; the raw date never leaves the machine). Once-only is guaranteed for
  sequential use; two *concurrent* first-use runs may rarely double-fire a milestone
  (R7's lock-free last-write-wins state) — accepted: OS file locking isn't worth its
  failure modes for a diagnostics stream, and rare duplicates dedup server-side. This
  is the activation/retention keystone: install → first_receipt is the product's
  activation rate.
- **R6 — Pseudonymous install identity.** `crypto.randomUUID()`, generated on first
  telemetry-enabled run, stored only in R7 state. The wire carries only
  `sha256("aireceipts-install-v1:" + installId)` as lowercase hex. Never derived from
  hostname, username, MAC, machine ID, repo, or path. Kill switches (SPEC-0002 R4)
  prevent creation; an existing ID is inert while disabled. Reset = delete
  `~/.aireceipts/state.json` (documented). Honest framing everywhere (docs, notice,
  this spec): this links runs to an install over time — that is its purpose — while no
  field identifies a person; anyone unwilling to be counted pseudonymously uses the kill
  switches, which also stop ID creation.
- **R7 — Local state + `aireceipts stats`.** New `~/.aireceipts/state.json`, resolved
  with the same call-time `AIRECEIPTS_HOME`-aware path convention as
  `src/telemetry/notice.ts:33` and `src/budget/config.ts:16`: {schemaVersion,
  installId?, firstRunAt, runCount, receiptCount, milestones}. Read/write is fail-safe
  (corrupt/unwritable → counters silently skip; buckets render `unavailable`; the file
  self-heals on the next successful write; concurrent runs may lose an increment —
  last-write-wins, never corruption or a crash). A new `stats` command (own file under
  `src/cli/commands/`, SPEC-0018 registry rules) prints the local counter — receipts
  generated on this machine, total runs, first-run date — satisfying "show how many
  receipts have been generated so far." The output labels the scope plainly ("on this
  machine") so the number can never be misread as a fleet total. **Counters are a local
  product feature**: they keep working with telemetry disabled (like `budget.json`);
  only `installId` is telemetry-gated. Determinism guard: state is write-only from
  command paths *after* rendering; nothing under `src/receipt/**`, `src/pricing/**`, or
  `src/parse/**` may read it; the counter never appears in receipt output (I5 — goldens
  unchanged).
- **R8 — Recording seam.** `CommandDef.run(ctx)` returns only an exit code
  (`src/cli/types.ts:49`), so R3–R5 fields cannot be reported from `main()`. The
  `CommandContext.telemetry` seam (`src/cli/types.ts:28`) gains typed recorders
  (`recordReceiptGenerated(...)` etc.) whose inputs are already-bounded values — the
  enum/bucket conversion happens in `src/telemetry/helpers.ts`-style converters, never
  in command code. Commands call recorders at the point where the data exists; `main()`
  keeps exactly what SPEC-0018 R6 gave it: lifecycle `cli_run`/`cli_error` recording and
  the single bounded flush. Tests inject a fake seam.
- **R9 — Disclosure moves with the schema.** Same release: first-run notice text
  (`src/telemetry/notice.ts:14`) gains "anonymous usage events + a random install
  identifier"; `docs/telemetry.md` documents every new event field-by-field (parity with
  schemas) and states plainly that (a) the install identifier links events from the same
  install, and (b) like any HTTPS request, the sink records an arrival time per batch —
  the payload-field ban on raw counts/timestamps is about *fields we choose*, not a
  denial of transport metadata. README one-liner still accurate. New leakage fixtures:
  payloads seeded with paths/prompts/dollar strings/raw counts/raw UUIDs must be
  rejected by every new schema. The banned-forever list (SPEC-0002 R3) is unchanged and
  applies to all nine events; raw counts and raw timestamps join it **as payload
  fields** (buckets only).
- **R10 — `--telemetry-show` sends nothing (bug fix).** `main()`
  (`src/cli/index.ts:26-36`) currently records `cli_run` and flushes even when the
  selected command is `telemetry-show`, contradicting SPEC-0002 R5's "prints … instead
  of sending." Fix inside `main()` — lifecycle ownership stays where SPEC-0018 R6 put
  it: when the selected command is `telemetry-show`, record nothing and skip the flush.
  The command keeps printing exactly the queued events (no invented samples). The
  registry-lifecycle test row asserting telemetry-show records+flushes
  (`test/cli/registry-lifecycle.test.ts:97`) is updated to assert the opposite, citing
  this spec.
- **R11 — Rails unchanged.** One bounded `flushTelemetry({timeoutMs: 300})` at
  shutdown; fail-safe everywhere; kill switches produce zero network calls; first-party
  App Insights sink only (`src/telemetry/config.ts` semantics untouched). Never adopt a
  third-party product-analytics SDK — that is the single most documented backlash
  trigger (GitLab 2019).

## Scenarios

- **Given** a user runs `aireceipts` on a Claude Code session with two stuck-loop waste
  lines, **when** the receipt renders, **then** one `receipt_generated` fires with
  `surface: receipt`, `hasStuckLoopWaste: true`, bucketed counts only — and
  `~/.aireceipts/state.json` `receiptCount` increments.
- **Given** the same machine's 3rd-ever receipt, **when** it renders, **then**
  `activation_milestone {milestone: third_receipt}` fires exactly once, and never again.
- **Given** `DO_NOT_TRACK=1` on a fresh machine, **when** 5 receipts render, **then**
  zero network calls occur, no `installId` is ever created, and `aireceipts stats`
  still prints "5".
- **Given** `aireceipts --telemetry-show`, **when** it runs, **then** the queued
  payloads print and the mocked network layer records zero calls (R10).
- **Given** a corrupt `state.json`, **when** any command runs, **then** nothing throws,
  ordinal buckets read `unavailable`, and the file is rewritten fresh on the next
  successful update.
- **Given** a session where some tool rows priced and others didn't, **when**
  `receipt_generated` fires, **then** `pricedRowCoverage: some` — and no dollar amount
  appears anywhere in the payload.

## Non-goals

- **No raw counts, timings, or timestamps as payload fields** — buckets only. The local
  file keeps exact counts (it never leaves the machine).
- **No per-stage pipeline timing events** — high volume, low decision value today.
- **No detail events for week/handoff/budget/benchmark** — R2 covers their adoption.
- **No `receipt_generated` from statusline/quota** — passive surfaces would flood the
  event stream and inflate the counter; they get `integration_surface_rendered` only.
- **No fleet-total counter inside the CLI** — that needs a network read in the product
  path (I1). The fleet total lives in the App Insights workspace; `stats` is local.
- **No theme/details/prior-state fields on R4 events** (S2 finding 11 trim) — marginal
  decision value; add only with a named decision that needs them.
- **No A/B testing, no update pings, no third-party analytics SaaS, ever.**
- **No identity linkage** — installHash links runs to an install; nothing links an
  install to a person, machine fingerprint, or repo.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 exhaustive names | event-name assertion | exactly the nine names, nothing else |
| R1 leakage fixtures | payloads w/ paths, prompts, $, raw UUIDs, raw counts | every new schema rejects |
| R2 command enum | each of the 18 commands | maps to its own enum value; unknown → dropped event |
| R2 isCI | `CI=true` env | `isCI: true`; unset → false |
| R2 runOrdinal boundaries | runCount 1, 3, 10, 51 | `1`, `2-3`, `4-10`, `>50` |
| R3 counter definition | receipt/compare/mini/pr render vs statusline/templates | former fire + increment; latter never |
| R3 payload fields | fixture session w/ waste + partial pricing | field-by-field golden for the payload |
| R3 ordinal bucket | receiptCount 1, 3, 7, 60 | `1`, `2-3`, `4-10`, `>50`; raw count absent from payload |
| R3 pricedRowCoverage | all/mixed/no rows priced | `all` / `some` / `none` |
| R4 result taxonomy | pr post w/ missing `gh`; hook install declined | `external_missing` / `declined` — never error text |
| R4 event shapes | each of the four detail events, per command path | fires from the real command path; zod validates; payload goldens |
| R5 once-only | same milestone twice | second run fires nothing |
| R5 installAge boundaries | firstRunAt now/−3d/−20d/−100d | `first_day`, `2-7d`, `8-30d`, `>90d` |
| R6 hash shape | installId on the wire | 64-hex sha256, never the raw UUID |
| R6 kill switch | fresh machine, `DO_NOT_TRACK=1` | no installId created, zero network (mocked layer) |
| R7 stats command | state with receiptCount 42 | `stats` prints 42 labeled "on this machine"; works with telemetry off |
| R7 determinism | goldens + determinism-check ×10 | byte-identical — state never read by render paths |
| R7 corrupt state | malformed JSON | no throw; `unavailable` buckets; self-heals |
| R7 concurrent runs | two interleaved read-modify-writes | valid JSON survives; a lost increment is acceptable, corruption is not |
| R8 seam | fake ctx.telemetry in command tests | recorders receive bounded values only |
| R10 show no-send | `--telemetry-show` under mocked network | zero calls, zero recorded events; lifecycle test updated |
| R9 docs parity | docs/telemetry.md vs schemas | field lists identical (parity test extended to all nine) |
| R9 governance parity | SPEC-0000 + AGENTS.md I4 | amended wording lands with the implementation |
| R11 budget | hung sender stub | CLI completes ≤300ms budget |

## Success criteria

- [x] All matrix rows green in the unmasked gate (2026-07-04; two pre-existing
      100-session opencode stress tests time out on the loaded dev machine — reproduced
      byte-identical on unmodified `main`, unrelated to this spec's rows; CI is the
      arbiter for those).
- [x] `docs/telemetry.md` documents all nine events; notice text updated; README still
      one honest sentence.
- [x] AGENTS.md I4 **and** SPEC-0000's telemetry sentences amended to name pseudonymous
      feature-adoption telemetry + this spec (founder-authorized; SPEC-0000 outranks).
- [x] `aireceipts stats` ships and prints the local receipts counter, labeled
      "on this machine" (live-walked 2026-07-04: fresh home → 1 receipt → `stats`
      prints 1; `DO_NOT_TRACK=1` → no installId, counter still works).
- [ ] Delivered `receipt_generated` events from telemetry-enabled installs are summable
      in the App Insights workspace (maintainer live-check, not CI; the sum is an
      **undercount** of true fleet volume — opt-outs and dropped batches don't appear —
      and must be labeled as such wherever it is published).
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, and `node scripts/hygiene.mjs` all pass unmasked
      (`echo $?`).

## Validation

**2026-07-04 · S1 (self):** all fields deterministic from local inputs; no dollars, no
rankings; two honesty fixes pre-review (receiptOrdinalBucket values pinned; `stats`
labeled "on this machine").

**2026-07-04 · S2 (Codex, independent, read-only): verdict REWORK → reworked same
session.** 12 findings. Accepted: (1) "unlinkable" wording was dishonest → reframed as
pseudonymous install-level tracking throughout; (2) envelope `time` contradicted the
raw-timestamp ban → ban scoped to payload fields, transport arrival time disclosed in
docs (R9); (3) `run(ctx)` exit-code seam cannot carry event fields → R8 recording seam
added (ctx.telemetry recorders, bounded inputs); (4) SPEC-0018 lifecycle conflict +
pinned test → R10 keeps ownership in `main()` and names the test to update; (5)
SPEC-0000 outranks and still said diagnostics-only → governance amendment added to
success criteria + matrix; (6) 17-vs-18 command enum with `stats` → pinned at 18; (7)
`pricedCoverage` not derivable as spec'd → redefined as row-level `pricedRowCoverage`
(`attribution.ts:44`); (8) matrix schema-heavy → command-path, boundary, concurrency,
governance rows added; (9) App Insights criterion not CI-verifiable → reworded as
maintainer live-check counting delivered events, labeled an undercount; (10) stale
cites → fixed (`blocks.ts:20`); (12) telemetry-show sample payloads muddied SPEC-0002's
"exact payload" promise → dropped, exact queue only. Partially accepted: (11) "cut R4
entirely" — rejected (founder directive is feature-adoption breadth; export/pr/hook
funnels are the point), but its riskiest fields (theme, detailsIncluded, priorState)
trimmed into a Non-goal.

**2026-07-04 · S3 (value):** kill criterion — if allowlist safety or determinism can't
hold, or install-linked events prove re-identifying, the expansion dies. Evidence it
survives: SPEC-0002's shipped rails already prove allowlist+determinism coexist (tests
green since 2026-07-02), and the three-stream research shows 14+ devtools shipping this
exact shape opt-out without mechanism backlash. Cheapest confirming experiment: the
leakage-fixture suite plus one maintainer dogfood run visible in App Insights.

**2026-07-04 · S4:** `node scripts/spec-lint.mjs` — 40 specs OK.

**2026-07-04 · S5 (Codex, implementation review, pre-push): verdict REWORK → applied.**
4 findings. Fixed: (2, blocker) a tampered/corrupt state file could persist a non-UUID
`installId` (a path, a hostname) that would be salted-hashed onto the wire — `parseState`
now drops anything that isn't a v4-shaped UUID, with a leakage test; (3) docs omitted
`unknown` from `parse_failure.agentType`; (4) command-path telemetry was only unit-tested
— added `test/cli/command-path-telemetry.test.ts` driving a real receipt render through
`main()` and asserting a bounded `receipt_generated` payload. Accepted with scope (1,
blocker): concurrent-run milestone double-fire — R5/R7 now state the lock-free
last-write-wins tolerance explicitly instead of adding OS file locks.

**2026-07-04 · maintainer approval (button 1):** approved by founder directive in the
commissioning session — "telemetry … should be speced and implemented," expansion scope,
privacy boundary ("shouldn't come at cost of leaking personal information"), and the
receipts counter all named by the maintainer directly. Approval recorded post-S2 rework,
consistent with the SPEC-0037 in-session approval precedent.
