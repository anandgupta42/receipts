# Receipts for Codex CLI

Full per-turn parsing: models, token usage, tool calls, and Codex's context
compactions surfaced as a heuristic pattern signal. (SPEC-0058; depth facts match
`src/parse/codex.ts`.)

## What you get

- **Per-turn parsing, request-granular pricing.** Each user-facing turn keeps
  its model, token usage, and tools (`exec_command`, MCP tools, …). Changed
  cumulative envelopes also remain separate request usage units, so a GPT-5.6
  >272K tier is selected per request rather than from an aggregated tool loop.
  Every unit uses its own persisted model, provider evidence, and timestamp;
  none is inherited later from an enclosing turn or session.
- **Request evidence fails closed.** Cumulative vectors must be monotone; each
  changed vector after the baseline must agree exactly with its non-zero
  `last_token_usage`; the file may not mix legacy and cumulative schemas, drop
  records, or disagree with the final local total. The first non-zero total
  also requires a non-zero `last_token_usage`: without it, inherited usage and
  the root rollout's first request are indistinguishable. Any failure disables
  all request-level pricing and preserves the full final cumulative envelope as
  unattributed tokens with an explicit caveat.
- **Provider-safe pricing.** Explicit `model_provider` is retained per request;
  recognized direct OpenAI traffic uses the cited table, while Azure, routed,
  or custom providers remain tokens-only. An absent provider field can still
  use model-id inference, but a request never borrows a provider from its turn.
- **Compaction detection.** Codex's context compactions are parsed and flagged
  as context-thrash patterns (SPEC-0040). Repeated compactions in one session
  carry their observable priced floor, not a claim that the work was avoidable.
- **PR attribution.** Codex sessions that committed on the branch are credited
  as contributors; Codex sessions in the repo's worktrees with no git writes
  appear under `CODEX HELPERS` in PR receipts — grouped honestly by what the
  credit rule proved.

Codex rollouts do not persist cache-write token counts, auth/billing route,
provider request/invoice identifiers, discounts, or credits. Receipts can
therefore reproduce a cited Standard-API-equivalent `≥` floor for observable
request components, not an invoice-exact charge.

## Where transcripts live

`~/.codex/sessions/**/*.jsonl` — written by Codex itself; aireceipts only
reads them.

## Quick start

```sh
npx aireceipts-cli            # receipt for your newest session
npx aireceipts-cli --list     # Codex sessions are listed alongside other agents
```

## Integration

- **Exact snippets:** `npx aireceipts-cli integrations codex` (e.g. an
  AGENTS.md instruction telling Codex to run the CLI at task end).
- No hook/statusline surface exists in Codex today; the CLI and the PR command
  are the integration points.

## Receipts on your PRs

`npx aireceipts-cli pr --post` — Codex helper sessions are attributed by
worktree + time window, committing sessions by branch SHA —
[how](../pr-receipts.md).

## Privacy

Read-only, local. Transcripts never leave your machine; pricing a receipt needs no
network — it uses bundled, cited price tables ([what a receipt proves](../trust.md)).
Anonymous, opt-out usage telemetry is the one exception (`AIRECEIPTS_TELEMETRY=off`).
