# Receipts for Claude Code

Full-depth support: per-turn models, per-tool attribution, cache tiers,
subagent rollups. Claude Code is also the only agent with always-on surfaces —
a session-end hook and a statusline. (SPEC-0058; depth facts match
`src/parse/claudeCode.ts`.)

## What you get

- **Per-turn parsing.** Every turn's model, token usage (input, output, cache
  read/write), and tool calls — so the receipt prices each tool line and shows
  the session's real model mix (e.g. `claude-opus-4-8 87% · claude-sonnet-5 13%`).
- **Same-id snapshots stay coherent.** Several records sharing one
  `message.id` remain one observable response group. The complete usage record
  with the highest output count is retained (later record wins a tie), rather
  than fabricating a vector from independent bucket maxima; repeated
  `tool_use.id` blocks count once.
- **Id-less usage fails closed.** Without `message.id`, repeated snapshots
  cannot be separated from distinct provider responses. Their tool evidence
  remains visible, but all id-less usage is reduced to one coherent
  highest-output envelope, carried as unattributed tokens, and never priced.
- **Cache visibility.** The `cache served N% of input tokens` masthead line and
  cache-tier pricing come straight from the transcript's usage records.
- **Subagents counted.** Sessions spawned via the Agent tool are discovered
  under the parent transcript and rolled into its receipt and PR attribution.
- **Waste lines.** Stuck tool loops, trivial spans, and context-thrash
  detection run at full precision on per-turn data.

## Where transcripts live

`~/.claude/projects/<project-slug>/*.jsonl` — Claude Code writes these itself;
aireceipts only reads them. Subagent transcripts nest under
`<session>/subagents/`.

## Quick start

```sh
npx aireceipts-cli            # receipt for your newest session
npx aireceipts-cli --list     # pick a specific session
```

## Always-on options

- **Session-end mini-receipt:** `aireceipts install-hook` (consent-gated; undo
  with `uninstall-hook`) — [guide](../guide/03-install-hook.md).
- **Live statusline:** `aireceipts statusline` in Claude Code's `statusLine`
  config — [setup](../statusline.md).
- **Exact snippets:** `npx aireceipts-cli integrations claude-code`.

## Receipts on your PRs

`npx aireceipts-cli pr --post` from your worktree attributes Claude Code
sessions (and their subagents) to the branch and posts the receipt comment —
[how](../pr-receipts.md).

## Privacy

Read-only, local. Transcripts never leave your machine; pricing a receipt needs no
network — it uses bundled, cited price tables ([what a receipt proves](../trust.md)).
Anonymous, opt-out usage telemetry is the one exception (`AIRECEIPTS_TELEMETRY=off`).
