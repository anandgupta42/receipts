# Receipts for Codex CLI

Full per-turn parsing: models, token usage, tool calls, and Codex's context
compactions surfaced as a waste signal. (SPEC-0058; depth facts match
`src/parse/codex.ts`.)

## What you get

- **Per-turn parsing.** Each turn's model and token usage, tool-by-tool cost
  attribution (`exec_command`, MCP tools, …), cache-read visibility.
- **Compaction detection.** Codex's context compactions are parsed and priced
  as context-thrash waste lines (SPEC-0040) — repeated compactions in one
  session are called out with their cost.
- **PR attribution.** Codex sessions that committed on the branch are credited
  as contributors; Codex sessions in the repo's worktrees with no git writes
  appear under `CODEX HELPERS` in PR receipts — grouped honestly by what the
  credit rule proved.

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

Read-only, local. Transcripts never leave your machine; rendering a receipt
makes zero network calls ([what a receipt proves](../trust.md)).
