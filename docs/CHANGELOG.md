# Changelog

All notable changes to `aireceipts-cli`. Factual, grouped by conventional-commit
type (I6: a log, not marketing). Dates are UTC.

## v0.2.0 — 2026-07-05

Minor: adds adoption telemetry + a local `stats` command (SPEC-0043), and lands
the security/privacy hardening from the v0.1.0 release-board findings (which were
live in v0.1.1).

### Added

- Adoption telemetry v2 (SPEC-0043): a nine-event catalog (feature-usage events,
  activation milestones), a pseudonymous random-UUID install identity sent only as
  a salted hash, and a local receipts counter — all content-free, opt-out, and
  disclosed in the updated first-run notice. (#110)
- `aireceipts stats` — a new command that prints your local receipts-generated /
  total-runs / first-run counts from `~/.aireceipts/state.json`; works fully
  offline and even with telemetry disabled, and never leaves your machine. (#110)

### Fixed

- PR-receipt cost confidence — the implemented slices of SPEC-0044 (the spec
  stays `building`: its `--self-check` kill-criterion and cost-model docs are
  still pending, so it is not flipped to `shipped`):
  - Every contributor drop/degrade/lower-bound now routes through a typed
    `ConfidenceEvent` and surfaces in the PR receipt — no more silent drops (the
    mirror of the #87 over-credit bug); a compile-time exhaustive switch + a
    hygiene guard make "no silent wrongness" a property. (#117)
  - Oracle-independent cost matrix (scenario × agent). (#120)
  - Receipt rows now sum to the displayed total. (#121)
  - Cache-write lower-bound caveat, only when actually under-priced. (#122)
  - Silent parse-skip and load-failure drops surfaced. (#123)
  - Grandchild subagent counted once, not twice. (#124)
  - `src/pr/**` mutation-gated + the silent-drop guard broadened. (#126)
- Strip terminal escape sequences (ANSI/CSI/OSC/nF) and C0/C1 control characters
  from all transcript-derived display text — session titles, tool names, and
  model-mix labels — across every adapter. A crafted transcript could previously
  emit raw escapes to the operator's terminal (e.g. recolor output or retitle the
  window via OSC-0). (#112)
- `aireceipts --list --json` on zero sessions now emits valid JSON `[]` on stdout
  with the message on stderr, instead of plain text that broke `| jq`. (#112)
- `aireceipts --telemetry-show` — the command that previews what telemetry would
  be sent — no longer records or flushes a `cli_run` event itself; previewing
  telemetry sent telemetry. (#115)
- Bump the summary-cache version so titles cached by the pre-sanitizer parser are
  re-parsed rather than served raw. (#112)

### Docs

- Correct README/getting-started privacy and coverage claims (transcripts/code
  never uploaded; diagnostics are opt-out; supported-agent list is finite);
  sync `docs/telemetry.md` agent-type enums and kill-switch examples; correct the
  `week --json` and `source` entries in `docs/json-schema.md`; drop a stale
  pre-release note. (#115)

### Chore

- Restructure the opencode combinatorial unit test: validate all summaries from
  one `listSessions()` and deep round-trip only a structural-coverage sample,
  instead of reopening the SQLite DB per session (6m40s → ~20s, coverage
  retained). Local `preflight-release.mjs` sets `AIRECEIPTS_SKIP_STRESS=1` so the
  spawn-heavy 100-session e2e stress case doesn't wedge on throttled dev macOS;
  CI runs the full suite (env unset), so coverage is unchanged.
- Ledger: SPEC-0040/0041/0042 flipped to `shipped` (they shipped in v0.1.1);
  `AGENTS.md` current-state inventory brought up to date; `CHANGELOG.md` added.

## v0.1.1 — 2026-07-04

First release through the OIDC trusted-publishing workflow (v0.1.0 was the manual
bootstrap).

### Added

- Parse Codex compaction records (`compacted` + `context_compacted`) into the
  normalized model, so `context-thrash` can fire on Codex sessions. (SPEC-0040)
- Real-session discovery filter: exclude workflow-journal artifacts under
  `subagents/` from listings; floor all-zero artifacts out of aggregate windows.
  (SPEC-0041)
- `--handoff` resume packet: a deterministic state header, a `covers:` line, and a
  versioned `--handoff --json` surface. (SPEC-0042)

### Chore

- Size two long-running SQLite test timeouts for macOS background-QoS throttling
  of vitest-spawned children; CI unaffected. (#111)

## v0.1.0 — 2026-07-04

Initial public release: the receipt engine and its full surface (parse adapters,
cited price tables, per-tool attribution, waste lines, compare, week, budget,
handoff, PR receipts, SVG/PNG export, templates, disclosed opt-out telemetry).
