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

- **R1 — Sender.** Fire-and-forget HTTPS post to Azure App Insights; hard 300 ms budget;
  any failure is swallowed silently. Telemetry can never block, slow past budget, or
  crash the CLI (fail-safe, not fail-fast).
- **R2 — Events.** Exactly three: `cli_run` {cliVersion, os, nodeMajor, command,
  agentType, durationBucket, ok}; `cli_error` {errorClass, command, agentType,
  inPackageFrame} where `inPackageFrame` is the top stack frame **only if inside the
  aireceipts package** (else omitted); `parse_failure` {agentType, adapterVersion,
  signatureHash} — a hash of the structural shape that failed, never the content.
- **R3 — Banned fields, enforced by test.** No transcript content, prompts, file paths,
  repo names, hostnames, usernames, session IDs, dollar amounts, raw model strings
  (family enum only), or free-text error messages. A unit test asserts every emitted
  payload against this denylist (regex for path-like/at-sign/slash-count patterns).
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
| R5 notice | fresh config dir | notice once, then never |
| R5 show | `--telemetry-show` | payload printed, nothing sent |

## Success criteria

- [ ] All matrix rows green in the unmasked gate.
- [ ] `docs/telemetry.md` published with the schema and kill switches.
- [ ] README discloses in one sentence with a link.
- [ ] Connection-string honesty: the ingestion key ships embedded **openly** (stated in
      docs/telemetry.md — it is an ingest-only key); `AIRECEIPTS_TELEMETRY_CONNECTION`
      overrides it, and setting it empty disables. Docs and code must agree — a
      docs-say-off/code-sends contradiction (the altimate-receipts footgun) fails review.

## Validation

*(pending /validate-spec)*
