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
- **Honest cheaper-model story (never a whole-session prediction).** We cannot know
  whether a cheaper model *would have managed the task*, so we never claim it. Three
  claims we can stand behind: (a) **price-delta** — same token volume at model X's list
  price, labeled as arithmetic, footnote-tier; (b) **routable spend** — re-price only
  spans where capability barely matters (short tool-free turns, identical-command
  retries): "~$1.68 of this session was trivial turns a cheaper model handles" (labeled
  estimate); (c) **`compare`** — the empirical answer: run the task on two models, two
  receipts side by side. Measure counterfactuals, don't predict them.
- **Paste-back handoff.** A compact block designed to be pasted into a PR description or
  a chat thread, not a link to a hosted page.

## Invariants (I1–I6)

- **I1 — Deterministic; zero model calls; zero network in the product path.** Same
  transcript → byte-identical receipt.
- **I2 — Never fabricate a dollar.** `$` renders only when a dated price-table row
  matches the session's model and date; otherwise render tokens. No silent fallback
  prices.
- **I3 — Every number traceable.** Price rows carry cited `sources:`; the receipt prints
  its attribution methodology; cheaper-model lines are labeled (arithmetic vs ≈ estimate),
  and no line ever claims another model would have completed the task.
- **I4 — Local-first; diagnostics-only telemetry, disclosed and escapable.** Offline-
  complete product; anonymous diagnostics to App Insights (perf + error + parse-failure
  signals only — the format-drift sensor). Never content/paths/repos/prompts/$ amounts.
  First-run notice, payload inspectable, `AIRECEIPTS_TELEMETRY=off` / `DO_NOT_TRACK=1`.
  Details + schema: SPEC-0002.

- **I5 — The receipt is a byte-stable contract.** Goldens gate all output changes.
- **I6 — Facts, not rankings.** Report what a session cost; never rank models or agents
  as better/worse.

## Roadmap

| Milestone | Delivers | Status |
|---|---|---|
| M1 | Receipt engine: parse adapters, price tables, per-tool attribution, waste lines, price-delta + routable-spend lines, compare, handoff, goldens | not started |
| M2 | Compare + handoff polish | not started |
| M3 | PNG export | not started |
| M4 | Opt-in benchmark (the only network call the CLI will ever make; explicit opt-in) | not started |

## OSS / indie / zero-telemetry stance

aireceipts is built in the open by one person, as OSS, MIT-licensed. It is not a company
product and is not gated behind a signup. It never phones home: no analytics, no crash
reporting beyond the I4 diagnostics contract. If a future opt-in feature
needs the network (e.g. a hosted benchmark corpus), it is off by default, named clearly,
and documented as the one exception. Price tables are maintained in the open via cited
PRs (`data/prices/`, the `update-prices` skill) — anyone can audit where a number came
from.

## Success criteria

- [ ] This spec is read and honored by every other spec and skill in the repo.
- [ ] No spec introduces a network call beyond the I4 diagnostics contract without amending I4 here
      first, with the founder's explicit approval.
