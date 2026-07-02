---
id: SPEC-0014
title: "Subscription quota context"
status: approved
milestone: M4
depends: [SPEC-0001]
---

# SPEC-0014 · Subscription quota context

Invariants: I1/I4 (zero network calls — local-only, no amendment to the diagnostics
contract), I2 (never fabricate a percentage when the local surface is unavailable).

## Purpose

Opt-in `--quota` surfaces Claude Code's **current rate-limit window usage** — "your 5h
window is at N% (official, from Claude Code's local data)". S2 correction adopted: the
documented `rate_limits.*.used_percentage` is *current window state*, not a per-session
delta — v1 never claims "this session used N%" (that needs start/end baselines, a
future spec). The primary surface is Claude Code's statusline stdin payload; standalone
disk reads only if R1's spike finds a real locally-written state file. No network
calls; nothing found → prints nothing. **Kill criterion:** R1 finding no local surface
ships this as a documented no-op — a valid close, not a failure.

## Requirements

- **R1 — Feasibility spike (blocking).** Verify, on a real local Claude Code install,
  whether any locally-readable surface (the JSON payload Claude Code's own `statusLine`
  mechanism receives, or a local account/session state file) exposes rate-limit or
  quota-window data. Document the exact field(s) and location found — or their absence
  — in the PR description before implementing R2.
- **R2 — `--quota` (if R1 clears).** Renders the current-window usage exactly as the
  local surface states it: `your <window> window is at N% (official, from Claude Code's
  local data)`. In statusline stdin mode (SPEC-0007 R3a) the payload's `rate_limits`
  fields are used directly; standalone mode reads the R1-located file if any. Never a
  per-session share, never arithmetic on the percentage. Single point-in-time read,
  no polling.
- **R3 — Zero network calls.** `--quota` never makes an HTTP request of its own; it only
  parses what Claude Code has already written locally. No config flag in this spec
  turns on a network fetch — a networked version is its own future, I4-amending spec.
- **R4 — Unavailable case.** When the local surface doesn't exist, isn't readable, or R1
  found nothing, `--quota` prints nothing and exits 0 — never an error, never a
  placeholder estimate (I2 extended from dollars to percentages).
- **R5 — Scope.** Claude Code only in this spec. Other agents have no equivalent local
  surface identified yet — out of scope here, not assumed absent forever.

## Scenarios

- **Given** R1 finds a real local quota surface, **when** `--quota` runs mid-window,
  **then** one labeled percentage line prints, zero network calls made.
- **Given** R1 finds nothing, **when** this spec ships, **then** `--quota` is documented
  as unavailable in v1 and prints nothing when invoked, exit 0.
- **Given** the local surface exists but is malformed or stale, **when** `--quota` runs,
  **then** it prints nothing (R4), never a stale or wrong percentage.
- **Given** `--quota` on a non-Claude-Code session, **when** invoked, **then** nothing
  prints (R5).

## Non-goals

Any networked quota fetch (explicit, pending a future I4 amendment); quota data for
agents other than Claude Code (R5); live/polling quota display; predicting window reset
times beyond what the local data states outright.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 spike documented | real Claude Code install | surface + fields recorded in PR, or absence documented |
| R2 quota line | rate_limits on statusline stdin | current-window line, verbatim percentage, single read |
| R2 no session-share claim | any mode | output never contains "session used" phrasing |
| R3 no network | --quota invoked | zero HTTP requests (verified per SPEC-0002 R6's no-network test) |
| R4 unavailable | surface absent/malformed/stale | nothing printed, exit 0 |
| R5 non-Claude-Code | Codex/Cursor session, --quota | nothing printed |

## Success criteria

- [ ] PR documents R1's spike finding either way — "unavailable" is an acceptable close.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`).

## Validation

**2026-07-02 · S2 (Codex): REWORK → reworked.** Semantics corrected: v1 reports
current-window usage (what `rate_limits.used_percentage` actually is), never a
per-session share (baseline-capture is a future spec); primary surface re-based on the
statusline stdin payload per the documented contract, with standalone file reads gated
on the R1 spike. **S4:** spec-lint green.
