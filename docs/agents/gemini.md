# Receipts for Gemini CLI

Full-depth support: per-turn models, tools, and cache tokens, including nested
subagent chats. (SPEC-0058; depth facts match `src/parse/gemini.ts`.)

## What you get

- **Per-turn parsing.** Each turn's model, token usage (with cache tokens),
  and tool calls — priced per tool line when a cited price row matches the
  model and date.
- **Subagent chats recognized.** A chat recorded as a subagent is labeled a
  sidechain and joins discovery alongside the main session's chats.
- **Honest unpriced rendering.** A Gemini model without a cited, dated price
  row shows tokens only — never a guessed dollar (I2).

## Where transcripts live

`~/.gemini/tmp/<projectHash>/chats/*.jsonl` — one file per session, written by
Gemini CLI itself; aireceipts only reads them.

## Quick start

```sh
npx aireceipts-cli            # receipt for your newest session
npx aireceipts-cli --list     # Gemini sessions appear alongside other agents
```

## Integration

- **Exact snippets:** `npx aireceipts-cli integrations` (recipes list).
- No hook/statusline surface exists for Gemini CLI; the CLI and the PR command
  are the integration points.

## Receipts on your PRs

`npx aireceipts-cli pr --post` attributes Gemini sessions under the same
conservative branch rules as every agent — [how](../pr-receipts.md).

## Privacy

Read-only, local. Transcripts never leave your machine; pricing a receipt needs no
network — it uses bundled, cited price tables ([what a receipt proves](../trust.md)).
Anonymous, opt-out usage telemetry is the one exception (`AIRECEIPTS_TELEMETRY=off`).
