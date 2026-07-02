---
id: SPEC-0006
title: "Session-end auto-receipt hook"
status: draft
milestone: M3
depends: [SPEC-0001]
---

# SPEC-0006 · Session-end auto-receipt hook

Invariants: I1 (deterministic, no polling, no side effects on the agent), I2/I3 (the
mini-receipt obeys the same $ honesty rules as the full one), I5 (byte-stable).

## Purpose

`aireceipts install-hook` writes a Claude Code `SessionEnd` hook entry into
`~/.claude/settings.json` (after an explicit consent prompt) that prints a 6-line
mini-receipt when a session closes — an ambient retention anchor that shows up without
the user running a command. Demand is real, not assumed: Anthropic's own tracker asks
for exactly this (`github.com/anthropics/claude-code/issues/9463`, "cost summary on
session exit"), and the install-hook pattern itself has peer precedent (clerk,
claude-receipts, hyperweave all ship a session-end snippet the same way). **Kill
criterion:** must install a working `SessionEnd` snippet on a clean box in <30s, or kill
before launch.

## Requirements

- **R1 — Consent-gated install.** `install-hook` reads (or creates) `~/.claude/settings.json`,
  prints the exact JSON diff it will apply, prompts `[y/N]`, and writes only on an
  explicit `y`. Declining leaves the file untouched, exit 0.
- **R2 — `SessionEnd`, not `Stop`.** The hook targets Claude Code's `SessionEnd` event
  (fires once per session close), not `Stop` (fires after every turn — would spam a
  receipt per response). If the installed Claude Code version doesn't support
  `SessionEnd`, `install-hook` reports that and makes no edit.
- **R3 — Non-destructive merge.** The hook entry is appended to any existing `hooks`
  array; every other key in `settings.json` is byte-identical before/after. Re-running
  `install-hook` when already installed is a no-op (idempotent), not a duplicate entry.
- **R4 — `--mini` render.** The hook invokes `npx aireceipts --mini`, a new flag
  producing exactly 6 lines: agent · model · duration, cost-or-tokens total (I2: no `$`
  unless priced), top-1 tool by cost, one waste line if any fired else "no waste
  detected", and a footer pointing at the full receipt command. Deterministic, golden-gated.
- **R5 — `uninstall-hook`.** Removes exactly the entry R1 added; no-op if absent; never
  touches unrelated hooks.
- **R6 — Fire-and-forget.** The hook never blocks Claude Code's own exit, never changes
  its exit code, and swallows its own errors (mirrors SPEC-0002 R1's fail-safe stance).

## Scenarios

- **Given** a fresh `settings.json`, **when** `install-hook` runs and the user confirms,
  **then** the `SessionEnd` entry is appended and the next session close prints exactly
  6 lines.
- **Given** an existing `settings.json` with unrelated hooks, **when** `install-hook`
  runs, **then** only the new entry is added; the rest is byte-identical.
- **Given** the user declines the prompt, **when** `install-hook` runs, **then** the
  file is untouched, exit 0.
- **Given** `uninstall-hook` on a file without the entry, **when** it runs, **then**
  no-op, exit 0.
- **Given** an unpriced session, **when** `SessionEnd` fires, **then** the mini-receipt
  is tokens-only, zero `$` bytes.

## Non-goals

Hooks for agents without an equivalent local hook surface (Codex, Cursor — none
identified; degraded to no hook, not a fake one); auto-updating the installed entry on
`aireceipts` version bumps (manual reinstall); any hook that can fail or block the
agent's own shutdown (R6).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 consent | fresh settings.json, confirm | entry appended |
| R1 decline | fresh settings.json, decline | untouched, exit 0 |
| R2 event choice | Claude Code w/o SessionEnd support | reported, no edit |
| R3 merge | settings.json w/ other hooks | only new entry added, rest byte-identical |
| R3 idempotent | already installed | no duplicate entry |
| R4 mini render | priced + unpriced fixture | exactly 6 lines each; no `$` when unpriced |
| R5 uninstall | installed / absent | entry removed / no-op |
| R6 fail-safe | hook invocation throws | Claude Code's own exit unaffected |

## Success criteria

- [ ] A real `~/.claude/settings.json` install/uninstall round-trip, byte-diffed, attached
      to the PR (dogfood).
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`).
- [ ] `--mini` golden fixtures committed for priced + unpriced sessions.
