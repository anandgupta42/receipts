---
id: SPEC-0062
title: "Statusline v2 — brand prefix, quota default-on, opt-in segments with a labeled quota ETA"
status: approved # maintainer button 1, 2026-07-06 (interactive session)
milestone: M5
depends: [SPEC-0007, SPEC-0014, SPEC-0061]
---

# SPEC-0062: Statusline v2 — brand prefix, quota default-on, opt-in segments with a labeled quota ETA

## Purpose

The statusline is aireceipts' most-seen surface, and it currently spends its first
segment naming the host (`[Claude Code]`) inside the host's own status bar while
saying nothing about who produced the number. Meanwhile the stdin payload Claude Code
already sends carries official rate-limit state (`rate_limits.*.used_percentage`,
`resets_at` — SPEC-0014 spike) that subscribers only see via a separate `--quota`
call. This spec rebrands the prefix, folds one quota fact into the default line, and
adds an opt-in `--format` segments engine whose segments include a clearly-labeled
`≈` quota-exhaustion estimate. All four features maintainer-picked 2026-07-06.
Serves **I2/I3** (every new segment is an official passthrough fact or labeled
arithmetic on two observed readings — never a prediction dressed as a fact) and
**I5** (default-line changes are deliberate and test-pinned). Staged build: R1/R2
first (small, self-contained), R3/R4 second on the same spec.

## Requirements

- **R1 — Brand prefix.** The default line's prefix becomes `[aireceipts]` when the
  session came from the stdin payload (the host is Claude Code by construction — its
  name is redundant in its own status bar). In disk-fallback mode the agent label
  still matters (the newest session may be Codex/Gemini/etc.), so the prefix renders
  `[aireceipts · <agentLabel>]`. `renderMiniSummary`'s 6-line surface is untouched
  (test-pinned).
- **R2 — Quota default-on.** When the stdin payload carries a usable
  `rate_limits.five_hour.used_percentage` (the same `isUsablePercentage` guard
  `src/cli/quota.ts:20` applies), the default line appends ` · 5h <pct>%`
  (integer-rounded passthrough; the 7d window stays off the default line — one quota
  fact at default width). Absent/malformed payload fields → segment omitted,
  byte-identical to SPEC-0061's tail (SPEC-0014 R4 semantics; never a guess).
- **R3 — `--format` segments engine.** `aireceipts statusline --format "<spec>"`
  renders a `·`-joined line from comma-separated segment names (whitespace around
  commas ignored; duplicates render twice — the format is literal). New value-flag
  plumbing in `src/cli/options.ts` (no `--format` option exists today — building the
  seam is part of this spec, same pattern as existing value flags). An unknown or
  empty segment name fails: exit 1, the valid segment list on stderr, nothing on
  stdout (fail-fast — a typo'd format must not silently render a partial line).
  Segments — exactly the picked set, nothing speculative:
  `brand, cost, tokens, waste, quota5h, quota7d, quotaEta`.
  `cost`/`tokens`/`waste` reuse the SPEC-0007/0061 values byte-for-byte;
  `quota5h`/`quota7d` are R2's passthrough facts (7d available here even though the
  default omits it). Stdin-only segments (`quota*`) omit themselves in disk-fallback
  mode. The default line ≡ `brand, cost, tokens, waste, quota5h` — one renderer, the
  default is just a format (no duplicated truths).
- **R4 — Quota ETA, labeled arithmetic.** `quotaEta` renders
  `≈ 5h cap <UTC HH:MM>` by straight-line interpolation between exactly two observed
  `(observedAtMs, used_percentage)` readings: the current invocation's and the
  previous one persisted in `~/.aireceipts/quota-window.json`. State-file contract:
  write is atomic (temp file + rename, the repo's existing pattern), any unreadable/
  unparseable/schema-invalid state is discarded and rewritten (self-healing, exit 0),
  and a lost race between concurrent invocations is harmless (last writer wins; the
  file is a cache of one reading, never a ledger). The segment renders only when ALL
  hold, each decidable from the two readings + payload alone: same window
  (`resets_at` identical), rising usage (`pct2 > pct1`), readings ≥ 60s apart (kills
  near-zero-denominator noise), the prior reading is not in the future (clock-skew
  guard), and the projected crossing lands before `resets_at`. Otherwise the segment
  is omitted entirely — an ETA after reset is meaningless; flat/falling usage
  projects nothing. The `≈` label is mandatory; never on the default line; opt-in
  via `--format` only.
- **R5 — Parity, latency, telemetry, docs.** All segments obey I2 (`cost` omits
  itself on an unpriced session, never zero-fills). Latency: the existing 200ms
  in-process budget test (`test/cli/statusline.test.ts:194` — model build + rollup)
  gains a variant that also runs quota parsing and the R4 state read/write; the
  budget is that in-process pipeline, not wall-clock process spawn. Telemetry:
  `integration_surface_rendered` gains a `customFormat` boolean (strict schema,
  fixtures, and `docs/telemetry.md` updated together — the SPEC-0043 pattern);
  `docs/statusline.md` documents every segment and the ETA's honesty rules in the
  same PR.

## Scenarios

- **Given** a stdin invocation with quota data, **When** the default line renders,
  **Then** it reads `[aireceipts] $12.40 · 1,012k tok · 5h 23%` (waste segment when
  fired).
- **Given** `--format "brand,quotaEta"` with two same-window rising readings 5m
  apart, **When** the line renders, **Then** the ETA segment carries the `≈` label
  and a UTC time before the window's `resets_at`.
- **Given** a first-ever invocation (no state file), **When** `quotaEta` is
  requested, **Then** the segment is omitted and the rest of the format renders.
- **Given** `--format "brand,bogus"`, **When** the command runs, **Then** exit 1
  with the valid segment list on stderr and empty stdout.

## Non-goals

- **Colors/ANSI, powerline glyphs, themes, width contracts** — the host owns
  presentation; plain `·`-joined text (SPEC-0007's constraint stands).
- **Segments beyond the picked set** (cache %, model id, reset time, `week`/budget) —
  each is either speculative UX with no named consumer or a per-invocation corpus
  scan; propose separately with a consumer attached.
- **A quota history beyond two readings** — one prior reading bounds the state file
  and keeps the arithmetic explainable ("straight line between two observations");
  curve-fitting is prediction territory (I3).
- **`--quota` command changes** — it stays the verbose passthrough surface.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 stdin brand | stdin payload session | line starts `[aireceipts] ` |
| R1 disk fallback | no payload, newest is codex | line starts `[aireceipts · Codex] ` |
| R1 mini untouched | 6-line mini render before/after | byte-identical |
| R2 quota on | payload with `five_hour.used_percentage: 23.5` | ` · 5h 23%` appended |
| R2 quota absent/malformed | payload without/with out-of-range rate_limits | tail byte-identical to SPEC-0061's line |
| R3 format render | `--format "cost,tokens"` | exactly those segments, `·`-joined |
| R3 whitespace + duplicate | `--format " brand , brand "` | two brand segments; whitespace ignored |
| R3 unknown/empty segment | `--format "bogus"` / `--format ""` | exit 1, stderr lists valid segments, stdout empty |
| R3 default ≡ format | default vs `--format "brand,cost,tokens,waste,quota5h"` | byte-identical output |
| R3 waste segment | session with a fired waste line | `⚠` segment renders in a custom format |
| R3 quota7d | payload with both windows, `--format "quota7d"` | `7d <pct>%` renders |
| R3 disk-fallback quota | no payload, `--format "brand,quota5h"` | quota segment omitted, brand renders |
| R4 eta happy path | two same-window readings, rising, 5m apart | `≈ 5h cap <UTC HH:MM>`, time < resets_at |
| R4 eta cold start | no state file | segment omitted, no error |
| R4 eta window rollover | `resets_at` differs between readings | segment omitted, state replaced |
| R4 eta falling/flat usage | second reading ≤ first | segment omitted |
| R4 eta near-zero gap | readings 5s apart | segment omitted (60s guard) |
| R4 eta clock skew | prior reading timestamped in the future | segment omitted, state replaced |
| R4 eta corrupt state | state file is garbage | segment omitted, file rewritten, exit 0 |
| R4 eta post-reset projection | crossing lands after resets_at | segment omitted |
| R5 I2 | unpriced session with `--format "cost,tokens"` | no `$` bytes; tokens render |
| R5 latency | children fixture + quota payload + state file, full pipeline | within the 200ms in-process budget |
| R5 telemetry | default vs `--format` run | `customFormat` false/true, strict schema passes |

## Success criteria

- [ ] R1–R5 implemented (staged: R1/R2 may land first); statusline tests updated
      (no loosened assertions) plus the R4 state-file battery.
- [ ] `docs/statusline.md` segment reference + ETA honesty note; `docs/telemetry.md`
      `customFormat` row — same PR as the code they describe.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass unmasked
      (`echo $?`).

## Validation

*2026-07-06 — S1 self-audit, S2 Codex (read-only sandbox), S3 worth gate, S4 lint.*

- **S1:** every rendered value is an official payload passthrough, an existing
  SPEC-0007/0061 value, or two-point interpolation with a mandatory `≈` label and
  omission-on-ambiguity guards — nothing unmeasurable; I2 preserved by cost-segment
  omission; I6 untouched (facts, no rankings).
- **S2 (Codex) — accepted:** no `--format` plumbing exists (`src/cli/options.ts`) →
  spec now names building the value-flag seam as in-scope; missing matrix rows
  (tokens/waste/quota7d, whitespace, duplicates, empty format, malformed payload,
  disk-fallback omission, mini-untouched) → added; state-file contract
  underspecified → atomic-rename, self-healing, last-writer-wins race semantics
  specified with a test battery; near-zero denominator + clock skew undecidable →
  60s-gap and future-timestamp guards added; latency claim overbroad → scoped to
  the in-process pipeline the existing 200ms test measures; `resets <HH:MM>`
  date-ambiguous → the `quotaReset` segment was cut entirely; scope creep
  (`cache`/`model`/`quotaReset`) → cut to the picked set.
- **S2 — noted, overridden by maintainer selection:** Codex recommends cutting R4
  (quotaEta) as the weakest requirement and deferring R3 as over-engineering
  ("smallest valuable change is R1+R2"). Both were explicitly picked by the
  maintainer (2026-07-06 interactive session); the staged-build note (R1/R2 first)
  adopts the risk-ordering half of the recommendation while keeping the picked
  scope. If R4's guards prove noisy in practice, the segment's omission-first
  design means it degrades to silence, not wrong numbers.
- **S3 — worth:** *Who/how often:* the maintainer (subscriber, statusline always on)
  plus every subscriber who installs `statusline` — the quota question ("how close am
  I to the cap?") recurs every working session; the branding question is a
  GTM-surface fact (every screenshot of the status bar currently advertises nothing).
  *Recurring:* structurally, per session. *Do-nothing:* the default line keeps
  spending its prefix on redundant host naming, and quota stays a separate command
  nobody discovers. *Smaller fix:* R1+R2 alone — acknowledged as the core; kept as
  the first build stage. *Steelman the cut:* segments/ETA serve power users only and
  add a state file; countered by opt-in-only placement (never on the default line)
  and omission-first honesty. *Kill criterion:* if the R5 latency variant cannot
  hold 200ms, or R4's guards omit the segment in >90% of real invocations (making it
  dead weight), the corresponding stage is reworked or tombstoned before ship.
  **Verdict: build now, staged (R1/R2 → R3/R4).**
- **S4:** `node scripts/spec-lint.mjs` — pass.
