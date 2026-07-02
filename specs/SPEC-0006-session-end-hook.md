---
id: SPEC-0006
title: "Session-end auto-receipt hook"
status: draft
milestone: M3
depends: [SPEC-0001, SPEC-0007]
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
- **R2 — `SessionEnd`, not `Stop` — proven, not assumed.** The hook targets Claude
  Code's `SessionEnd` event (once per session close), not `Stop` (per-turn spam). A
  blocking dogfood spike against a real installed Claude Code version records: that
  `SessionEnd` fires, the observed hook payload shape, and the version tested — in the
  PR, before implementation. If the installed version lacks `SessionEnd`,
  `install-hook` reports that and makes no edit.
- **R3 — Non-destructive structural merge.** `settings.json`'s hooks are NESTED
  (`hooks.SessionEnd[].hooks[]` command objects — the shape this repo's own
  `.claude/settings.json` uses), not a flat array; `install-hook` writes exactly one
  `{"matcher": "*", "hooks": [{"type": "command", "command": "npx aireceipts --mini"}]}`
  entry under `hooks.SessionEnd`. Unparseable JSON aborts with a message and NO write.
  Writes are atomic (tmp file + rename) with a one-shot `settings.json.bak` backup.
  Preservation is structural (every other key/entry deep-equal before/after), not
  byte-identical (formatting may normalize — stated to the user in the R1 diff).
  Re-running when installed is an idempotent no-op.
- **R4 — `--mini` render (shared model).** The hook invokes `npx aireceipts --mini`:
  exactly 6 lines rendered from the SAME shared mini-summary structure SPEC-0007's
  statusline consumes (one model, two surfaces — no duplicated logic): agent · model ·
  duration, cost-or-tokens total (I2), top-1 tool by cost, one waste line or "no waste
  detected", footer pointing at the full receipt. Deterministic, golden-gated.
- **R5 — `uninstall-hook`.** Removes exactly the entry R1 added; no-op if absent; never
  touches unrelated hooks.
- **R6 — Fire-and-forget, timeout-wrapped.** The installed command is wrapped with a
  hard timeout (the snippet itself uses a bounded invocation) so the hook can never
  block Claude Code's exit or change its exit code; errors are swallowed (SPEC-0002 R1
  fail-safe stance). The R2 spike observes and records actual exit behavior.

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
| R2 spike recorded | real Claude Code install | SessionEnd fired + payload shape + version in PR |
| R3 merge | settings.json w/ other hooks | new nested entry only; all other keys deep-equal |
| R3 unparseable | corrupt settings.json | abort + message, file untouched |
| R3 atomic+backup | any install | tmp+rename write; .bak created once |
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

## Validation

**2026-07-02 · S2 (Codex): REWORK → reworked.** Accepted: exact nested
`hooks.SessionEnd[].hooks[]` shape specified (flat-array assumption killed against this
repo's own settings.json); parse-error abort + atomic write + backup; structural (not
byte-identical) preservation; blocking platform spike for SessionEnd behavior + payload;
timeout-wrapped command; depends on SPEC-0007's shared mini-summary model, duplicate
`--mini` logic cut. **S4:** spec-lint green.
