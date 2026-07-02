---
id: SPEC-0000
title: aireceipts product vision and invariants
status: approved
milestone: M0
depends: []
---

# SPEC-0000: aireceipts product vision and invariants

## Purpose

aireceipts is a local, deterministic CLI that turns an AI coding-agent transcript sitting
on disk into a **cost receipt**: what the session actually spent, tool by tool, and what
it could have cost done differently. It answers one question a developer keeps asking
after every agent session — "was that worth it?" — without a server, an account, or a
dashboard. This spec is the binding reference for every other spec in this repo; when in
doubt, this file wins.

## The four differentiators

- **Multi-agent sources.** Reads transcripts from more than one coding agent (Claude
  Code, Codex, and others as adapters land) through one adapter interface, not a
  single-vendor tool.
- **Per-tool breakdown.** Cost and time are attributed per tool call, not just a session
  total — the receipt shows *where* the money went.
- **Counterfactual re-pricing.** "This session on model X would have cost ≈$Y" —
  a labeled estimate, computed from the same transcript against a different price row.
- **Paste-back handoff.** A compact block designed to be pasted into a PR description or
  a chat thread, not a link to a hosted page.

## Invariants (I1–I6)

- **I1 — Deterministic; zero model calls; zero network in the product path.** Same
  transcript → byte-identical receipt.
- **I2 — Never fabricate a dollar.** `$` renders only when a dated price-table row
  matches the session's model and date; otherwise render tokens. No silent fallback
  prices.
- **I3 — Every number traceable.** Price rows carry cited `sources:`; the receipt prints
  its attribution methodology; counterfactuals are labeled estimates (≈).
- **I4 — Local-first, zero telemetry, ever.** The only network use is the opt-in
  benchmark command, if it ever ships — and it says so out loud.
- **I5 — The receipt is a byte-stable contract.** Goldens gate all output changes.
- **I6 — Facts, not rankings.** Report what a session cost; never rank models or agents
  as better/worse.

## Roadmap

| Milestone | Delivers | Status |
|---|---|---|
| M1 | Receipt engine: parse adapters, price tables, per-tool attribution, waste lines, counterfactual, compare, handoff, goldens | not started |
| M2 | Compare + handoff polish | not started |
| M3 | PNG export | not started |
| M4 | Opt-in benchmark (the only network call the CLI will ever make; explicit opt-in) | not started |

## OSS / indie / zero-telemetry stance

aireceipts is built in the open by one person, as OSS, MIT-licensed. It is not a company
product and is not gated behind a signup. It never phones home: no analytics, no crash
reporting, no update pings, by default and permanently (I4). If a future opt-in feature
needs the network (e.g. a hosted benchmark corpus), it is off by default, named clearly,
and documented as the one exception. Price tables are maintained in the open via cited
PRs (`data/prices/`, the `update-prices` skill) — anyone can audit where a number came
from.

## Success criteria

- [ ] This spec is read and honored by every other spec and skill in the repo.
- [ ] No spec introduces a network call in the product path without amending I4 here
      first, with the founder's explicit approval.
