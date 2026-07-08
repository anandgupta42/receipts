---
id: SPEC-0071
title: "Statusline rich default — burn rate, context %, quota reset countdown, M/B tokens"
status: shipped
milestone: M5
depends: [SPEC-0062]
---

# SPEC-0071: Statusline rich default

Invariants: I2 (never a fabricated dollar — a `$` segment renders only when priced), I3
(every number traceable; the reset countdown derives from Claude Code's real `resets_at`,
never estimated), I5 (byte-stable output — exact-string `renderSegments` unit tests gate the
shape), I6 (facts, not rankings). Every
segment stays an **honest passthrough** of Claude Code's own payload field or a deterministic
value from aireceipts' own priced ledger — nothing is invented.

## Purpose

The default statusline (`brand,cost,tokens,waste,quota5h`, SPEC-0062) renders `5h 26%` — which
is Claude Code's authoritative `rate_limits.five_hour.used_percentage`, but reads as ambiguous
(26% of *what*?) and drops the reset time (the actionable part). It also renders `501,368k tok`
for ~501M tokens. This spec makes the default line the researched best-in-class shape —
`[aireceipts] $423 · $80/hr · 501M · ctx 42% · 5h 26% ↺2h13m` — by fixing token formatting,
adding a **burn rate** and **context %** segment, and giving the 5h window an inline reset
countdown. **Kill criterion:** any segment that cannot be rendered from a real payload field or
a priced ledger value (i.e. would require estimating) is cut, not faked.

## Requirements

- **R1 — `tokens` uses abbreviated M/B formatting.** The `tokens` segment renders
  `formatShortTokens(totalTokens)` (`371k` / `1.2M` / `501M`), not `formatTokensK`'s
  `501,368k tok`. Fixes the unreadable large-count case.
- **R2 — new `context` segment.** `ctx N%` from `payload.context_window.used_percentage`
  (Claude Code sends a pre-calculated 0–100 value; docs confirm). Guarded exactly like the
  rate-limit windows: absent, non-numeric, or out of `[0,100]` → segment omitted (the same
  guard rejects the known CC epoch-timestamp bug). `N = Math.round(used_percentage)`.
- **R3 — new `burn` segment (deterministic, from aireceipts' own ledger).** `$X/hr` where
  `X` is `totalUsd / (durationMs / 3_600_000)` — the session's priced spend over its
  wall-clock, from `MiniSummary.totalUsd`/`durationMs` (aireceipts' cited-price figure, NOT
  Claude Code's estimate, for I2 consistency with the `cost` segment). Rendered as **whole
  dollars once ≥ `$1/hr`** (glanceable) and **cents below `$1/hr`** (so a real small burn is
  never rounded away to the misleading `$0/hr`). Omitted when `unpriceable`, `totalUsd` is
  `null`/non-finite/negative, `durationMs` is absent/non-finite/`≤ 0`, or the computed rate is
  non-finite (no fabricated `$NaN`/`$Infinity`/negative rate — Codex #1). It is a session-average
  rate (a labeled fact); a rolling-window burn is a non-goal (below).
- **R4 — `quota5h` gains an inline reset countdown.** `5h N% ↺Xh Ym` (e.g. `5h 26% ↺2h13m`)
  where the countdown is `resets_at * 1000 - nowMs` (`resets_at` is epoch **seconds**, per
  `quotaWindow.ts:16`). Rendered `Xh Ym` above an hour, `Ym` under. The countdown is dropped
  (leaving `5h N%`) when `resets_at` is absent, already past, non-finite, **or absurdly far out
  (> ~8 days — a 5h/7d window never resets further, so a garbage/ms-as-seconds value is rejected,
  not rendered as `↺499505000h0m` — Codex #2)** — never a negative or fabricated time. `quota7d`
  gets the same treatment.
- **R5 — the default format becomes the rich line.** `DEFAULT_FORMAT =
  "brand,cost,burn,tokens,context,waste,quota5h"` (the existing `waste` flag is kept — it
  renders only when a waste line fired, so it's free on clean sessions and preserves aireceipts'
  differentiator). `burn` and `context` are added to `SEGMENT_NAMES`
  so `--format` can name them; `quotaEta`/`quota7d` remain opt-in. A segment with nothing
  honest to say still returns `null` and is omitted (I2/I3) — so a cheap early session with no
  duration/context/rate-limit data degrades to just `[aireceipts] $X · <tokens>`.
- **R6 — no color in v1.** Segments return plain strings (the engine is plain-text). Threshold
  color-coding (burn/context green/yellow/red) is a deliberate follow-on non-goal.
- **R7 — exact-string unit tests.** The statusline is verified by byte-exact `renderSegments`
  unit assertions (there is no golden infrastructure for the statusline in this repo), covering:
  the new rich default on a full-payload fixture; each new segment's guard (absent/out-of-range/
  non-finite → omitted); the reset countdown format, its past/absent/**absurd** fallback, and
  the same countdown on `quota7d`; and M/B token formatting.

## Scenarios

- **Given** a full stdin payload (cost, duration, `context_window.used_percentage`, five_hour
  `used_percentage`+`resets_at`), **when** the default statusline renders, **then**
  `[aireceipts] $423 · $80/hr · 501M · ctx 42% · 5h 26% ↺2h13m`.
- **Given** a payload with `rate_limits` but no `resets_at`, **when** it renders, **then**
  `… 5h 26%` (no countdown, no fabricated time).
- **Given** a `resets_at` already in the past, **when** it renders, **then** `5h N%` (fallback,
  never a negative countdown).
- **Given** `context_window.used_percentage = 1700000000` (the CC epoch bug), **when** it
  renders, **then** the `context` segment is omitted (out of `[0,100]`).
- **Given** an unpriceable (Cursor) session or one with no `durationMs`, **when** it renders,
  **then** the `burn` segment is omitted (no fabricated `$/hr`).
- **Given** a session of 501,368,000 tokens, **when** `tokens` renders, **then** `501M`.
- **Given** the disk-fallback mode (no stdin payload), **when** it renders, **then** `context`
  and `quota*` are omitted (no payload), `burn` renders if the fallback session is priced.

## Non-goals

- **Color / ANSI thresholds** (burn/context red-yellow-green) — follow-on (R6).
- **Rolling-window / active-block burn rate** — v1 is session-average (honest, deterministic);
  a recent-velocity burn needs windowing and its own evidence.
- **Preferring Claude Code's `cost.total_cost_usd`** over aireceipts' own priced figure — the
  `cost`/`burn` segments stay on aireceipts' cited-price ledger (I2 consistency); CC's
  client-side estimate is not mixed in.
- **A multi-line statusline / powerline** — aireceipts' edge is a glanceable single line.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 tokens M/B | 501,368,000 tokens | `501M` |
| R2 context | `context_window.used_percentage: 42` | `ctx 42%` |
| R2 context guard | `used_percentage: 1.7e9` or absent | segment omitted |
| R3 burn | totalUsd 40, durationMs 1.8e6 (0.5h) | `$80/hr` |
| R3 burn omitted | unpriceable / totalUsd null / durationMs 0 | segment omitted |
| R4 countdown | `resets_at` 2h13m ahead | `5h 26% ↺2h13m` |
| R4 sub-hour | `resets_at` 45m ahead | `↺45m` |
| R4 no reset | `resets_at` absent | `5h 26%` (no countdown) |
| R4 past reset | `resets_at` in the past | `5h N%` (fallback) |
| R4 absurd reset | `resets_at` a ms value (huge) | `5h N%` (countdown omitted, not `↺…000h0m`) |
| R4 quota7d | `seven_day` reset ahead | `7d N% ↺…` (same countdown) |
| R5 default | full payload | the rich line, in order |
| R5 degraded | payload with only cost | `[aireceipts] $X · <tokens>` |
| R6 plain text | any rendered segment | no ANSI escape codes in the output |
| R7 non-finite burn | `totalUsd` NaN / `durationMs` NaN | `burn` omitted (no `$NaN/hr`) |

## Success criteria

- [x] The rich default renders as specified on a full-payload fixture; each new segment omits
      cleanly on absent/out-of-range data (no fabricated `$/hr`, `%`, or countdown).
- [x] Reset countdown derives from real `resets_at` (epoch seconds), with the past/absent
      fallback; `tokens` uses `formatShortTokens`.
- [x] Exact-string `renderSegments` tests pin the rich default and every segment guard
      (non-finite burn, absurd/absent/past reset, out-of-range context, M/B tokens).
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/spec-lint.mjs` all pass unmasked (`echo $?`).

## Validation

**2026-07-08 · S1 (self):** clean on I2/I3/I6 for the normal path; the self-audit missed the
non-finite/absurd numeric edges S2 caught.

**2026-07-08 · S2 (Codex, on the implementation): 4 findings, all fixed.**
1. *Accepted (High, I2).* `burn` didn't guard non-finite/negative `totalUsd`/`durationMs` → could
   render `$NaN/hr`/`$Infinity/hr`/negative. Now guards finite + non-negative + finite computed
   rate (R3); tests added.
2. *Accepted (High, I3).* A garbage/ms-as-seconds `resets_at` rendered `↺499505000h0m`. Added a
   `MAX_RESET_COUNTDOWN_MS` (~8 days) cap so absurd values omit the countdown (R4); test added.
3. *Accepted (Medium).* R7 said "goldens" but the statusline has no golden infra here — reworded
   to byte-exact `renderSegments` unit tests, and added the missing `quota7d` countdown test.
4. *Accepted (Low).* R3 said `round(...)`; the implementation shows cents below `$1/hr` (so a real
   small burn isn't hidden as `$0/hr`) — the spec now documents that better behavior, not `round`.

**2026-07-08 · S3 (worth): who + how often** — every Claude Code user with the statusline
configured, every render; the `5h 26%` label was actively confusing (the maintainer flagged it).
**do-nothing** — the misleading quota label and unreadable `501,368k` persist. **smaller fix** — the
label/token fix alone is the floor; the maintainer chose the full rich line (cost/burn/tokens/
context/quota+reset) via an explicit design question. **steelman the cut** — none: every segment is
an honest passthrough or a deterministic ledger value, and it's opt-out via `--format`.

**Verdict: BUILD NOW** (built; Codex-reviewed; all findings fixed).

**S4 (spec-lint): pass.**
