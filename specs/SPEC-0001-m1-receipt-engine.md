---
id: SPEC-0001
title: "M1 — the receipt engine: parse, price, attribute, render, compare, handoff"
status: draft
milestone: M1
depends: []
---

# SPEC-0001 · M1 — the receipt engine

Invariants in play: **I1** (deterministic, zero model calls, offline-complete), **I2**
(never fabricate a dollar), **I3** (every number traceable + methodology printed), **I5**
(receipt is a byte-stable golden contract), **I6** (facts, never rankings).

## Purpose

`npx aireceipts` reads the newest AI coding-agent session already on disk and prints a
till-receipt: what the session cost, per tool; where it was wasted; what the honest
cheaper-model story is; and a paste-back block for the agent. This is the whole product;
everything later builds on the primitives this milestone lands.

## Requirements

- **R1 — Adapters.** Discover and parse local transcripts into one normalized `Session`
  model: Claude Code (`~/.claude/projects/**/*.jsonl`), Codex (`~/.codex/sessions`),
  Cursor (local DB). Extract from the private altimate-receipts repo (founder owns both;
  re-license MIT): `src/trace/types.ts`, `load.ts`, `registry.ts`, `claudeCode.ts` +
  `anthropic.ts`, `codex.ts`, `cursor.ts` — stripped of receipt/attestation/store code.
  A session that fails to parse degrades gracefully (skip + stderr note), never crashes.
- **R2 — Price resolution.** `data/prices/<vendor>.json` (schema per `data/prices/README.md`)
  loaded and resolved by (model, session date) → the price row whose
  `from_date`/`to_date` window contains the date. No match → tokens-only mode (I2). The
  M1 PR seeds Anthropic + OpenAI tables **via the update-prices skill** with real cited
  sources — the citation hook and CI cite-check apply from the first row.
- **R3 — Per-tool attribution.** Each assistant turn's usage (input/output/cache tokens →
  USD when priced) is attributed to the tool(s) called in that turn; multi-tool turns
  split evenly; tool-free turns attribute to `(thinking/reply)`. The methodology is a
  single exported string constant, printed on every receipt (I3).
- **R4 — Waste lines.** Two deterministic detectors, ported not invented:
  (a) **stuck loop** — identical tool+input ≥3 consecutive → line with cost + wall-clock;
  (b) **routable spend** — short tool-free turns on a premium model, priced and labeled
  `≈` (the honest fraction of "could have been cheaper"; see Non-goals).
- **R5 — The receipt.** Fixed-order render: masthead (agent · start · duration · model
  mix) → per-tool lines desc by cost → waste lines → TOTAL → cheaper-model lines
  (routable-spend `≈` line; price-delta arithmetic as a labeled footnote) → tokens-only
  fallback when unpriced → methodology footnote → samosa footer. `NO_COLOR` respected;
  timestamps rendered absolute (no "3m ago") so output is byte-stable (I5).
- **R6 — CLI surface.** Default = newest session across agents → receipt. `--list`,
  positional selector, `--json` (full structured breakdown), `compare <a> <b>`
  (side-by-side + delta line), `--handoff` (deterministic paste-back block built only
  from fired waste lines).
- **R7 — Determinism harness.** Same transcript in, byte-identical receipt out; goldens
  re-run ×20 under frozen `NO_COLOR`/locale/TZ in CI.

## Scenarios

- **Given** a real Claude Code session with a stuck loop, **when** `npx aireceipts` runs,
  **then** the receipt shows per-tool dollars, a loop line with $ + minutes, and TOTAL —
  and running it twice yields identical bytes.
- **Given** a session on an unknown/unpriced model, **when** the receipt renders, **then**
  no `$` appears anywhere — token totals + "no price table matched" note (I2).
- **Given** two sessions, **when** `aireceipts compare a b` runs, **then** two receipts
  render side-by-side with a delta line and no claim about which model is "better" (I6).
- **Given** a session with zero waste lines, **when** `--handoff` runs, **then** it prints
  "nothing to hand off" and exits 0 — never invents advice.

## Non-goals

- Whole-session cheaper-model predictions ("on Haiku this'd be $X") — banned per I3;
  the ladder is price-delta arithmetic + routable-spend `≈` + `compare` (empirical).
- PNG/SVG export (M3), quota-% display, benchmark/telemetry (SPEC-0002), OpenClaw
  adapter (post-M1 via add-vendor-adapter), any hosted/team surface.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 parse each agent | 2+ real fixture transcripts per adapter (sanitized) | normalized Session; goldens |
| R1 corrupt file | truncated JSONL | skipped with stderr note, exit 0 |
| R2 dated pricing | fixture model + 2 price rows w/ windows | row matching session date picked |
| R2 no match | unknown model | tokens-only receipt, zero `$` bytes |
| R3 attribution sums | multi-tool + tool-free turns | per-tool totals sum to session total (property test) |
| R4 loop fires | fixture with 5 identical Bash retries | loop line with $ and duration |
| R4 no false fire | clean session fixture | zero waste lines (eval-corpus precision 1.0) |
| R5 byte stability | any fixture ×20 runs | identical bytes (R7 harness) |
| R6 compare | two fixtures | side-by-side + correct delta ratio |
| R6 handoff empty | clean fixture | "nothing to hand off", exit 0 |

## Success criteria

- [ ] `npm run build && node dist/cli.js` prints a real receipt from the founder's live
      `~/.claude/projects` (acceptance run recorded in the PR).
- [ ] Unmasked gate green: `tsc`, `eslint --max-warnings 0`, `vitest run`, goldens,
      spec-lint — each with visible exit codes.
- [ ] Stryker config lands with `src/pricing/**`; mutation job green (fail-closed rule).
- [ ] Eval corpus seeded (≥6 fixtures incl. 2 clean) with precision 1.0 gate.
- [ ] Price tables carry cited sources; CI `prices` job green.
- [ ] PR includes the receipt of the session that built it (dogfood).

## Agent team config

Roles by directory ownership (never by feature):
- **core-engine** (critical path): `src/parse/**`, `src/pricing/**` — owns the `Session`
  and pricing contracts everyone else consumes. Sonnet.
- **surface**: `src/receipt/**`, `src/cli/**` — renderer + flags; consumes core's
  contracts, never edits them. Sonnet.
- **test-writer**: `test/**`, `goldens/**`, `eval/**`, fixtures — owns the test matrix
  above as a checklist. Sonnet.

| Wave | Tasks (parallel within a wave) | Gate |
|---|---|---|
| 1 | core-engine: extract+land `Session` types & adapter shells · test-writer: sanitize fixtures from real sessions · surface: CLI skeleton w/ `--help` | tsc green |
| 2 | core-engine: adapters parse fixtures + price resolution · test-writer: adapter tests | R1/R2 rows green |
| 3 | core-engine: attribution + waste detectors (+ Stryker config) · surface: receipt renderer | R3/R4 rows + mutation green |
| 4 | surface: compare/handoff/--json · test-writer: goldens + eval corpus + determinism harness | full matrix green |

Critical path: core-engine wave 1→2→3. Lead coordinates, resolves contract questions,
runs the unmasked gate at every wave boundary (TaskCompleted hook mirrors it).

## Validation

*(pending /validate-spec — S1 self-audit, S2 independent critic, S3 value gate, S4 lint)*
