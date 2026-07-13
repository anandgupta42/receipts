---
id: SPEC-0081
title: First-run conversion — the npx moment renders value or a next step, never a dead end
status: rejected
milestone: M6
depends: [SPEC-0043]
---

# SPEC-0081: First-run conversion — the npx moment

## Purpose

The 2026-07-10/11 announcement cohort (App Insights, content-free events) shows the
funnel dying at the first command: 22 new installs; 20 `receipt`-class runs of which
**13 exited non-zero**; 11 `--help` runs; **2** `install-hook` runs; **zero**
`receipt_generated`. Two product causes and one measurement cause: (a) the
no-session path prints a five-path directory dump with a `--demo` pointer nobody
takes (`src/cli/common/session.ts:24`); (b) failures on machines *with* odd agent
state exit non-zero with no recovery path; (c) `setup` and `integrations` are
invisible to telemetry — they are absent from `COMMAND_VALUES`
(`src/telemetry/schemas.ts:19`) and dropped at `src/telemetry/index.ts:69` — so the
setup step of the funnel cannot be measured at all. This spec makes the first 60
seconds land and makes the funnel measurable. Serves I2/I6 (a demo must never be
mistakable for the user's own dollars) and SPEC-0043 (telemetry stays content-free).

## Requirements

- **R1 — no-session TTY path renders the demo receipt, bannered.** When session
  discovery finds nothing and stdout is a TTY, render the `--demo` receipt directly,
  topped and tailed by an unmissable banner line (`SAMPLE RECEIPT — not your data`,
  exact copy in the golden) plus a three-line next-step ladder: run your agent once →
  re-run `aireceipts` → `aireceipts install-hook` for always-on. Non-TTY (piped/CI)
  keeps a terse machine-friendly message and exit 0 — never the demo (a script must
  not ingest sample numbers; I2). The five-path directory dump moves behind
  `--verbose`; default copy is ≤ 4 lines before the sample.
- **R2 — every no-match failure carries a next step.** A selector that matches
  nothing, an unreadable store, or a discovery error must print one actionable line
  (what was looked for, the closest command that would work: `--list`, `--demo`,
  `--verbose`) before exiting. No bare non-zero exits on the first-run surface
  (`receipt`, `--list`, `--mini`, `setup`).
- **R3 — `setup` and `integrations` join the `cli_run` catalog.** Add both to
  `COMMAND_VALUES` with the standard content-free dimensions only. This closes the
  docs-audit finding (docs/telemetry.md currently documents the gap) and makes the
  install → configure funnel measurable. `docs/telemetry.md` updated in the same PR.
- **R4 — `--quota` / `--check-budget` say so when there is nothing to report
  (#248).** On a TTY, one stderr line each (`no Claude Code quota data found` /
  `no budget.json — see docs/guide/08-budget.md`), exit code unchanged. Hook mode
  (non-TTY stdout) keeps byte-silence — those surfaces are parsed.
- **R5 — funnel instrumentation proves the fix.** `activation_milestone` (existing
  event) gains `first_run_demo_shown` and `first_run_next_step_shown` milestone
  values (booleans/enums only — no new identifying dimensions, I4). Kill criterion
  reads from these.

## Scenarios

- **Given** a fresh machine with no agent transcripts and a TTY, **When** the user
  runs `npx aireceipts-cli`, **Then** they see the bannered sample receipt and the
  three-line ladder, exit 0.
- **Given** the same machine but stdout piped, **When** `aireceipts | cat` runs,
  **Then** output is the terse no-session message only — no sample dollars.
- **Given** sessions exist but a positional selector matches nothing, **When**
  `aireceipts zzz` runs, **Then** stderr names the selector, suggests `--list`, and
  the exit code is non-zero exactly as today.
- **Given** a TTY and no `budget.json`, **When** `aireceipts --check-budget` runs,
  **Then** stderr says so in one line and exit is 0; **When** the same command runs
  with stdout piped, **Then** it is byte-silent.

## Non-goals

- Changing which session "newest" selects (#247) — separate fix, orthogonal.
- A TUI wizard or interactive prompts — `npx` first runs are frequently in agent
  shells; prompts would hang them.
- Auto-installing the hook or writing any file on first run — configuration stays an
  explicit user action.
- Docs polish items from #249 — tracked there.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 TTY no sessions | bare run, empty sandbox HOME, TTY | bannered demo + ladder, exit 0 |
| R1 piped no sessions | same, stdout piped | terse message, no `$`, exit 0 |
| R2 no-match selector | `aireceipts zzz` with sessions present | actionable stderr, non-zero |
| R3 catalog | `setup` run with telemetry test transport | one `cli_run` with `commandClass: "setup"` |
| R4 quota TTY empty | `--quota`, no data, TTY | one stderr line, exit 0 |
| R4 quota hook mode | `--quota`, no data, piped | byte-silent, exit 0 |
| banner golden | demo-fallback render | golden byte-pins banner top+tail |
| R5 milestones | demo fallback + ladder shown, test transport | one `activation_milestone` each for `first_run_demo_shown` / `first_run_next_step_shown`; no `receipt_generated` |

## Success criteria

- [ ] R1–R5 implemented with the tests above; new goldens for the bannered fallback.
- [ ] `docs/telemetry.md`, `docs/guide/01-getting-started.md` updated in the same PR.
- [ ] Kill criterion recorded at ship time: if <10% of new non-CI installs reach
      `receipt_generated` or `hook_configured` within 7 days of first_seen over the
      30 days post-release, this approach is wrong — revisit or revert.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`).

## Validation

- **Date:** 2026-07-13 (same-day as draft).
- **S1:** initially passed on measurability/I2, but the causal chain was over-claimed —
  see S2 finding 1.
- **S2 (Codex, independent context): 7 findings, all accepted.** (1) The 13 non-zero
  `receipt` runs cannot be the bare no-session path — that path exits 0
  (`src/cli/commands/receipt.ts:51`); the diagnosis was hypothesis stated as fact.
  (2) R3 measures "setup report viewed," not "configured" — the funnel claim was
  inflated. (3) R5's kill criterion has no baseline and a ~22-install denominator —
  statistically meaningless. (4) Test matrix missed large parts of R1–R5.
  (5) R2 requires a cross-adapter error taxonomy — a different, bigger spec.
  (6) `--verbose` doesn't exist — a new flag smuggled in. (7) R4 reverses SPEC-0014's
  and SPEC-0009's deliberate silence contracts.
- **S3 worth:** Who/how often — unknown; the cohort's failure cause is unproven and
  post-hoc `cli_error` query returns zero events for the cohort (the failures were
  controlled non-zero exits, most plausibly no-match selectors — but that is still a
  hypothesis). Do-nothing — the current path exits 0, names roots, points to
  `--demo`; mildly verbose, not a dead end. Smaller fix — (a) add `setup`/
  `integrations` to `COMMAND_VALUES` (independent 2-enum change, already a docs-audit
  finding) and (b) instrument controlled non-zero exits with a content-free
  `exitClass` so the next launch window yields a real diagnosis; optionally (c) a
  copy-only tightening of the no-session message. Steelman-the-cut: building a
  conversion feature on an unproven diagnosis with an unmeasurable success criterion
  is exactly the over-eager-spec failure this gate exists to catch.
  **Verdict: defer.**
- **S4:** spec-lint pass.

## Tombstone

Parked 2026-07-13 after S2/S3. What was tried: a guided first-run (TTY demo fallback +
next-step ladder + funnel telemetry) motivated by the 2026-07-10/11 launch cohort's
13 failed receipt runs. Why rejected: the failure diagnosis is unproven (the bare
no-session path exits 0 and no `cli_error` events exist for the cohort), the proposed
kill criterion is unmeasurable at current install volume, R2 hid a cross-adapter error
taxonomy, and R4 reversed deliberate SPEC-0014/0009 contracts. What would change the
answer: instrument controlled non-zero exits first (content-free `exitClass` on
`cli_run` or a new small spec), collect one more launch window of data, and respec the
narrow intervention the evidence actually names. The two extracted slices —
`setup`/`integrations` in `COMMAND_VALUES`, and exit-class instrumentation — are small
enough to ship without this spec.
