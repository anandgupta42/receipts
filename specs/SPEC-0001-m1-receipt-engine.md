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
till-receipt: what the session cost, per tool; where it was wasted; the honest
cheaper-model lines; and a paste-back block for the agent. This is the whole product;
everything later builds on the primitives this milestone lands.

## Requirements

- **R1 — Adapters.** Discover and parse local transcripts into one normalized `Session`
  model. Extract from the private altimate-receipts repo (founder owns both; re-license
  MIT): `src/trace/types.ts`, `load.ts`, `registry.ts`, `claudeCode.ts` + `anthropic.ts`,
  `codex.ts` — stripped of receipt/attestation/store code. **Cursor is a degraded-mode
  adapter in M1**: its source (`cursor.ts`) exposes no model id and total-only tokens, so
  it supports `--list` and a tokens-only receipt, never priced per-tool attribution
  (I2-honest; own acceptance rows). A transcript that fails to parse degrades gracefully
  (skip + stderr note), never crashes.
- **R2 — Price resolution, written fresh (not ported).** The private repo's `cost.ts`
  regex-matches model families and falls back to a default price tier — that fallback
  violates I2 and is **banned**. New `src/pricing/**`: resolve (exact model id, session
  date) against `data/prices/<vendor>.json` rows by `from_date`/`to_date` window; any
  non-match → tokens-only mode. No default prices, no family guessing. The M1 PR seeds
  Anthropic + OpenAI tables **via the update-prices skill** with real cited sources.
- **R3 — Per-tool attribution.** Each assistant turn's usage (tokens → USD only when R2
  resolved) is attributed to the tool(s) called in that turn; multi-tool turns split
  evenly; tool-free turns attribute to `(thinking/reply)`. Methodology is one exported
  string constant, printed on every receipt (I3). Property test: per-tool totals sum to
  the session total.
- **R4 — Waste lines (new detectors, defined exactly).**
  (a) **Stuck loop**: a run of ≥3 *consecutive* tool calls with identical (tool name,
  normalized input) over the ordered turn sequence → one line with the run's allocated
  cost (R3) and wall-clock (last-end − first-start). The private repo's `sum.loops`
  counts non-consecutive repeats and carries no timestamps — write fresh.
  (b) **Re-priced trivial spans** (was "routable spend"): eligible span = assistant turn
  with zero tool calls AND output ≤ 120 tokens AND model id resolves via R2 to a row
  whose vendor also has a cheaper current row. Line = sum of eligible spans re-priced at
  that vendor's cheapest current row, rendered as `≈` with the label "re-priced eligible
  trivial spans" — never "a cheaper model would have handled this".
- **R5 — The receipt.** Fixed-order render: masthead (agent · start · duration · model
  mix, models ordered by token share) → per-tool lines desc by cost → waste lines →
  TOTAL → cheaper-model lines (R4b line; price-delta arithmetic footnote: same token
  volume at the vendor's cheapest current row, labeled "arithmetic, not a prediction")
  → tokens-only fallback when unpriced → methodology footnote → samosa footer.
  `NO_COLOR` respected; absolute timestamps only (I5).
- **R6 — CLI surface.** Default = newest session across agents → receipt. `--list`,
  positional selector, `--json` (full structured breakdown incl. per-tool, waste, price
  rows used), `compare <a> <b>` (side-by-side + delta line), `--handoff` (deterministic
  paste-back block built only from fired waste lines).
- **R7 — Determinism harness.** Same transcript in, byte-identical receipt out; goldens
  re-run ×20 under frozen `NO_COLOR`/locale/TZ in CI.

## Scenarios

- **Given** a real Claude Code session with a stuck loop, **when** `npx aireceipts` runs,
  **then** the receipt shows per-tool dollars, a loop line with $ + minutes, TOTAL — and
  running twice yields identical bytes.
- **Given** a session on an unpriced model, **when** the receipt renders, **then** no `$`
  byte appears — token totals + "no price table matched" note (I2).
- **Given** a Cursor session, **when** the receipt renders, **then** tokens-only mode with
  an explicit "Cursor transcripts carry no per-turn model/usage — totals only" note.
- **Given** two sessions, **when** `aireceipts compare a b` runs, **then** two receipts
  side-by-side with a delta line and no better/worse language (I6).
- **Given** zero waste lines, **when** `--handoff` runs, **then** "nothing to hand off",
  exit 0 — never invents advice.

## Non-goals

- Whole-session cheaper-model predictions ("on Haiku this'd be $X") — banned per I3.
- Priced Cursor attribution (until its transcript format exposes per-turn usage).
- PNG/SVG export (M3), quota-% display, telemetry implementation (SPEC-0002), OpenClaw
  adapter (post-M1), any hosted/team surface.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 parse claude-code + codex | 2+ sanitized real fixtures each | normalized Session; goldens |
| R1 cursor degraded | cursor fixture | listed; tokens-only receipt + note; no `$` |
| R1 corrupt file | truncated JSONL | skipped w/ stderr note, exit 0 |
| R2 dated pricing | model + 2 rows w/ windows | row matching session date picked |
| R2 no match / no fallback | unknown model id | tokens-only; zero `$` bytes |
| R2 cited seed tables | anthropic.json, openai.json | cite-check green in CI |
| R3 attribution sums | multi-tool + tool-free turns | per-tool totals sum to session total (fast-check property) |
| R4a loop fires | 5 identical consecutive Bash calls | one line, correct $ + duration |
| R4a non-consecutive | identical calls separated by others | no loop line |
| R4b eligible spans | short tool-free premium turns | `≈` line, exact formula amount |
| R4 no false fire | 2 clean fixtures | zero waste lines (eval precision 1.0) |
| R5 byte stability | any fixture ×20 | identical bytes (R7 harness) |
| R5 NO_COLOR + ordering | fixture w/ 2 models | no ANSI bytes; models by token share |
| R5 methodology + footnote | any priced fixture | methodology constant + price-delta footnote present |
| R6 --list | ≥2 agents' fixtures | ordered cross-agent list |
| R6 selector | explicit id | that session rendered |
| R6 --json | priced fixture | schema-valid JSON incl. price rows used |
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

Roles by directory ownership (never by feature). **Shared files have one named owner**:
`package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `src/index.ts`,
`stryker.config.json` → **core-engine**; `test/fixtures/**` and `data/prices/**` →
**test-writer** (prices seeded via update-prices skill); `eslint.config.js` → core-engine.
Any role needing a shared-file change requests it from the owner via the lead.

- **core-engine** (critical path): `src/parse/**`, `src/pricing/**` + shared configs —
  owns the `Session` and pricing contracts everyone else consumes. Sonnet.
- **surface**: `src/receipt/**`, `src/cli/**` — renderer + flags; consumes core's
  exported contracts, never edits them. Sonnet.
- **test-writer**: `test/**`, `goldens/**`, `eval/**`, fixtures, price tables — owns the
  test matrix as a checklist. Sonnet.

| Wave | Tasks (parallel within a wave) | Gate |
|---|---|---|
| 1 | core-engine: land `Session` types + adapter shells + **export the contracts** · test-writer: sanitize fixtures from real sessions | tsc green; contracts exported |
| 2 | core-engine: adapters parse fixtures + fresh pricing resolver · surface: CLI skeleton + `--help` against wave-1 contracts · test-writer: adapter tests + cited price tables | R1/R2 rows green |
| 3 | core-engine: attribution + R4 detectors + Stryker config · surface: receipt renderer | R3/R4 rows + mutation green |
| 4 | surface: compare/handoff/--json · test-writer: goldens + eval corpus + determinism harness | full matrix green |

Critical path: core-engine wave 1→2→3. Surface starts at wave 2 (after contracts
export), not wave 1 — sequencing added to avoid the contract-churn conflict. Lead
coordinates, resolves contract questions, runs the unmasked gate at every wave boundary.

## Validation

**2026-07-02 · S1 (self):** honesty ladder encoded (Non-goals bans prediction wording);
every `$`-producing path traces to a dated cited row or renders tokens-only.
**S2 (Codex, independent):** verdict REWORK → reworked same day. Accepted: routable-spend
formula made exact (R4b); pricing written fresh — ported Sonnet-fallback banned (R2);
consecutive-run loop detector defined w/ timestamps (R4a); Cursor demoted to degraded
tokens-only mode (R1); 9 missing matrix rows added; shared-file ownership + wave
sequencing fixed (Agent team config). **S3 (value):** kill criterion = a receipt from a
real session that a stranger reads without explanation; probe evidence (50% of sessions
carry loop waste w/ real $) says the waste lines will fire. **S4:** spec-lint green.
