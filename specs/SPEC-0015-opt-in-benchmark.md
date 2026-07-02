---
id: SPEC-0015
title: "Opt-in benchmark"
status: approved
milestone: M4
depends: [SPEC-0001, SPEC-0002]
---

# SPEC-0015 · Opt-in benchmark

Invariants: I1/I4 (kept separate from the diagnostics contract, its own value
exchange), I6 (cohort comparison, never a ranking).

## Purpose

`aireceipts benchmark` is the value-exchange design SPEC-0002/SPEC-0000 reserved. S2
scope correction adopted: percentiles + n<25 suppression require a hosted aggregate
service this OSS repo does not own — **v1 ships the client contract only**: payload
build, allowlist schema + leakage tests, `--dry-run`, and the `[y/N]` flow, with the
actual send disabled until a separate server spec (owning cohort definitions, abuse/
privacy policy, and the explicit I4/SPEC-0000 network exception) exists and names an
endpoint. Without a configured endpoint the accept path prints the payload + "benchmark
service not yet available" and exits 0. **Kill criterion:** if maintainer dogfood
(the only measurable denominator pre-server — declines make no network call and no
install ID exists) shows the payload/percentile design is misleading against a manually
verified case, kill before any server work.

## Requirements

- **R1 — Explicit per-call opt-in.** Every invocation prompts `[y/N]` — no persisted
  "always allow" default in v1. Declining exits 0, no network call. Accepting with no
  server endpoint configured prints the payload + "benchmark service not yet
  available", exits 0, no network call (v1 default state).
- **R2 — Allowlisted payload.** One bucketed event, built via a new zod schema separate
  from SPEC-0002's three diagnostics events (this is not a fourth diagnostics event —
  kept out of the I4 contract per SPEC-0002 Non-goals). Coarse buckets only (cost-per-
  turn bucket, waste-class-present booleans, agent type, model family) — never raw
  dollar amounts, transcript content, or file paths.
- **R3 — `--dry-run`.** Builds and prints the exact payload that would be sent, sends
  nothing, works without the `[y/N]` prompt (mirrors SPEC-0002 R5's `--telemetry-show`).
- **R4 — Cohort suppression.** The client renders "not enough data yet" when the server
  reports a cohort under 25 members, never a percentile computed on a small sample.
- **R5 — Comparison framing.** The returned percentile renders as "vs. a cohort of
  similar sessions" — never "better/worse than X" language (I6).
- **R6 — No persistence, no linkage.** No install ID, no repeated-caller token is sent;
  each opt-in is a fresh, unlinked event (matches SPEC-0002 Non-goals).

## Scenarios

- **Given** the user declines the `[y/N]` prompt, **when** `benchmark` runs, **then**
  zero network calls, exit 0.
- **Given** `--dry-run`, **when** run, **then** the exact payload prints, nothing sent,
  no prompt shown.
- **Given** the user accepts, **when** the event sends, **then** the payload validates
  against the allowlist schema (leakage fixtures rejected, mirroring SPEC-0002 R3).
- **Given** a cohort under 25 members, **when** the response returns, **then** the
  client renders "not enough data yet".
- **Given** a successful response, **when** rendered, **then** the percentile uses
  cohort-comparison language only.

## Non-goals

A persisted "always send" opt-in in v1 (R1 — every call re-prompts); merging this event
into SPEC-0002's diagnostics contract (kept separate); server-side implementation
details beyond the client-observable contract in R2/R4; historical percentile trends
over time.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 decline | [y/N] declined | zero network calls, exit 0 |
| R1 no server (v1 default) | accept, no endpoint configured | payload printed + unavailable note, zero network calls |
| R2 schema | payload built | validates against new allowlist schema; leakage fixtures rejected |
| R3 dry-run | --dry-run | exact payload printed, nothing sent, no prompt |
| R4 small cohort | server returns n<25 | "not enough data yet" rendered |
| R5 framing | successful response | cohort-comparison language, no ranking words |
| R6 unlinked | repeated invocations | no install ID / caller token in any payload |

## Success criteria

- [ ] Schema + leakage-fixture tests green; a `--dry-run` payload sample attached to the
      PR.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`).

## Validation

**2026-07-02 · S2 (Codex): REWORK → reworked.** Scope honesty adopted: v1 = client
contract only (payload, schema, leakage tests, dry-run, consent flow) with sends
disabled pending a separate server spec that owns cohorts/abuse/privacy and the I4
network exception; unmeasurable opt-in-rate kill criterion replaced with a
dogfood-verifiable one. **S4:** spec-lint green.
