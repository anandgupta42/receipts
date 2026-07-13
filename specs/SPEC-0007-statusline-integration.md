---
id: SPEC-0007
title: "Statusline integration"
status: approved
milestone: M3
depends: [SPEC-0001]
---

# SPEC-0007 · Statusline integration

Invariants: I1 (no live polling, no daemon), I2 (honest `$`/tokens), I6 (factual flag,
never a ranking).

## Purpose

`aireceipts statusline` prints one line — the last-completed session's cost-or-tokens
plus a waste flag — for Claude Code's `statusLine` command config. This is the proven
retention lever (the always-visible local usage-meter precedent: a number on every
prompt, no command to remember). **Kill criterion:** if the line adds no signal a user
notices within a week of daily use (vs. running `aireceipts` manually), cut it.

## Requirements

- **R1 — One line.** Prints one line: `[agent] $X.XX · Nk tok · <waste-flag>` when
  priced, `[agent] Nk tok · <waste-flag>` when unpriced (I2). Rendered from the same
  shared mini-summary structure SPEC-0006's mini-receipt uses (one model, two surfaces —
  no duplicated waste logic). No live/streaming updates mid-session (SPEC-0001 Non-goals).
- **R2 — Zero polling.** A single on-disk read per invocation; Claude Code re-invokes
  the statusline command on its own schedule — `aireceipts` runs no background process
  or cache daemon (I1).
- **R3 — Two input modes, measured fast path.** (a) **stdin mode**: when invoked by
  Claude Code's `statusLine` mechanism, consume the session JSON Claude Code passes on
  stdin (incl. `transcript_path`) and render from that session directly. (b) **disk
  mode** (no stdin payload): load the most-recently-ended session across adapters via
  `listSessions()` and a full `Session` parse — `SessionSummary` alone cannot price or
  detect waste. Latency cap: ≤200ms on the fixture corpus, asserted in the matrix.
- **R4 — Empty state.** No detected sessions → a neutral placeholder line, never an
  error or empty stdout that breaks the statusline layout.
- **R5 — Docs.** `docs/statusline.md` ships the exact Claude Code `statusLine` config
  snippet.

## Scenarios

- **Given** a priced session just ended, **when** `aireceipts statusline` runs, **then**
  one line with `$` + waste flag prints.
- **Given** only unpriceable (Cursor) sessions, **when** it runs, **then** tokens-only
  line, zero `$` bytes.
- **Given** no sessions detected anywhere, **when** it runs, **then** a neutral
  placeholder, exit 0.
- **Given** a waste line fired last session, **when** it runs, **then** the flag
  renders; given zero waste, no flag — factual, not "good/bad" framing (I6).

## Non-goals

Live/streaming updates mid-session (R1); multi-line output; theming beyond `NO_COLOR`;
cross-session aggregation (SPEC-0008's job, not this one's).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R3 stdin mode | statusline JSON w/ transcript_path on stdin | renders that session's line |
| R3 latency | disk mode over fixture corpus | ≤200ms wall clock |
| R1 priced line | last session priced | `$` + waste flag line |
| R1 unpriced line | last session unpriced | tokens-only line, zero `$` |
| R2 no polling | repeated invocations | each is a single fresh read, no cache/daemon |
| R3 fast path | large session fixture | summary-only read, no full turn parse |
| R4 empty state | zero sessions detected | placeholder line, exit 0 |
| R5 docs snippet | docs/statusline.md | matches a working Claude Code settings.json |

## Success criteria

- [ ] `docs/statusline.md` verified against a real Claude Code `settings.json` (dogfood).
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`).

## Validation

## Validation

**2026-07-02 · S2 (Codex): REWORK → reworked.** Accepted: `SessionSummary` cannot price/
flag waste — full-Session load with a measured 200ms cap (R3b); Claude Code's statusline
stdin contract adopted as the primary mode (R3a); SPEC-0006 overlap resolved by sharing
one mini-summary model across both surfaces (R1). **S4:** spec-lint green.
