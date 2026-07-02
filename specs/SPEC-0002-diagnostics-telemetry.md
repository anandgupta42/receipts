---
id: SPEC-0002
title: "Diagnostics telemetry — performance + issue signals via Azure App Insights"
status: draft
milestone: M1
depends: [SPEC-0001]
---

# SPEC-0002 · Diagnostics telemetry (I4 contract)

Founder decision 2026-07-02: aireceipts ships **anonymous, diagnostics-only** telemetry
to improve performance and catch issues. Amended I4 governs. This is viable as opt-out
precisely because nothing public exists yet — there is no prior "zero telemetry"
promise to break (the GitLab-2019 trap). Disclosure from day one is the contract.

## Purpose

Three product-improving signals, nothing else: (1) does the CLI work in the wild
(errors), (2) is it fast (latency), (3) did an agent vendor change its transcript format
(**parse-failure signatures — the format-drift sensor** that feeds the adapt-new-schema
maintenance loop).

## Requirements

- **R1 — Sender.** Events queue in-process; a bounded `flushTelemetry({timeoutMs: 300})`
  is awaited once at CLI shutdown — whatever hasn't sent when the budget expires is
  dropped. Any failure is swallowed silently. Telemetry can never block beyond the
  budget, throw, or change the exit code (fail-safe, not fail-fast).
- **R2 — Events.** Exactly three: `cli_run` {cliVersion, os, nodeMajor, commandClass,
  agentType, durationBucket, ok} where `commandClass` is the enum {receipt, compare,
  other} — not the raw command line. `cli_run` on success is deliberately kept (S2
  finding 12 considered): the founder's directive is performance improvement, and
  latency regressions are invisible without success-run durations; the payload is
  minimized to make it useless as usage analytics; `cli_error` {errorClass, command, agentType,
  inPackage: boolean} — whether the top stack frame is inside the aireceipts package;
  never frame text, file names, or line numbers (they are paths — R3); `parse_failure` {agentType, adapterVersion,
  signatureHash} — a hash of the structural shape that failed, never the content.
- **R3 — Allowlist schemas, enforced by construction.** Every event validates against a
  strict zod schema before send: enum-only or bounded-format fields, no free-text
  anywhere. Anything failing the schema is dropped, not sanitized. Leakage fixtures
  (payloads seeded with prompts, paths, model snapshots, dollar strings) must be
  rejected by the schema test. Banned forever: transcript content, prompts, file paths,
  repo names, hostnames, usernames, session IDs, dollar amounts, raw model strings.
- **R4 — Kill switches.** `AIRECEIPTS_TELEMETRY=off|0|false` and `DO_NOT_TRACK=1` both
  disable entirely; disabled means zero network calls (verifiable with the R6 test).
- **R5 — Disclosure.** One-time first-run notice (what is sent, what never is, how to
  disable); `aireceipts --telemetry-show` prints the exact payload of the current run
  instead of sending; `docs/telemetry.md` documents the full schema, field by field.
- **R6 — No-network proof.** A test runs the CLI with kill switch set under a mocked
  network layer and asserts zero outbound calls; a second test asserts the 300 ms budget.

## Scenarios

- **Given** `DO_NOT_TRACK=1`, **when** any command runs, **then** zero network calls occur.
- **Given** an adapter throws on a malformed transcript, **when** telemetry fires, **then**
  the event carries only errorClass + signatureHash — replaying the payload through the
  R3 denylist test shows no path/content fragments.
- **Given** first ever run, **when** the receipt prints, **then** the disclosure notice
  precedes it, and is never shown again.

## Non-goals

Usage analytics for marketing; fleet benchmarks / percentile comparisons (a future
opt-in with its own value exchange, separate spec); A/B testing; update pings; any
event tied to an identity. No persistent install ID in v1 — events are unlinked.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R2 shapes | each event type | zod schema validates; goldens for payloads |
| R3 denylist | synthetic payloads w/ path/prompt fragments | test fails the build |
| R4+R6 kill/no-network proof | env set, mocked network layer | zero outbound calls |
| R1+R6 budget | sender stubbed to hang | CLI completes; telemetry dropped ≤300 ms |
| R5 notice persistence | temp config dir, 3 runs | notice on run 1 only |
| R5 show | `--telemetry-show` | payload printed, nothing sent |
| R2 exactly three | exhaustive event-name assertion | only cli_run/cli_error/parse_failure exist |
| R2 commandClass enum | every CLI command | maps into {receipt, compare, other} |
| SC conn-string | AIRECEIPTS_TELEMETRY_CONNECTION="" | disabled; zero calls |
| SC conn-string override | custom value set | events go to the override target |
| SC docs agreement | docs/telemetry.md vs zod schemas | field lists identical (parity test) |

## Success criteria

- [ ] All matrix rows green in the unmasked gate.
- [ ] `docs/telemetry.md` published with the schema and kill switches.
- [ ] README discloses in one sentence with a link.
- [ ] Connection-string honesty: the ingestion key ships embedded **openly** (stated in
      docs/telemetry.md — it is an ingest-only key); `AIRECEIPTS_TELEMETRY_CONNECTION`
      overrides it, and setting it empty disables. Docs and code must agree — a
      docs-say-off/code-sends contradiction (the altimate-receipts footgun) fails review.

## Validation

**2026-07-02 · S1 (self):** connection-string honesty rule added pre-review (open embedded
key, docs/code agreement). **S2 (Codex, independent):** verdict REWORK → reworked same
day. Accepted: bounded `flushTelemetry` replaces fire-and-forget (R1); `inPackage`
boolean replaces stack-frame text (R2); public contract phrase aligned across README /
SPEC-0000 / I4 ("offline-complete with opt-out diagnostics telemetry"); denylist
replaced with strict allowlist zod schemas + leakage fixtures (R3); 7 matrix rows added.
**Partially accepted (finding 12):** success-run `cli_run` kept — founder's directive is
performance improvement and latency regressions need success durations — but payload
minimized (commandClass enum {receipt, compare, other}, no raw commands) to be useless
as usage analytics. **S3 (value):** parse_failure is the format-drift sensor the
maintenance loop needs; cli_error is table-stakes for an npx tool. **S4:** spec-lint green.
