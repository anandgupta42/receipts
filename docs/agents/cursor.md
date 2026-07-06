# Receipts for Cursor

**Honest degraded mode: session totals only, tokens only.** Cursor's local
history carries no per-turn model ids, no cache/usage breakdown, and no real
per-message timestamps — so a Cursor receipt shows the session's totals and
**never renders dollars**: every Cursor session is flagged unpriceable and the
pricing layer skips it (I2 — no fabricated precision, no fabricated dollars).
aireceipts states what it can prove and nothing more. (SPEC-0058; depth facts
match `src/parse/cursor.ts`.)

## What you get

- **Session totals, tokens only.** One receipt per Cursor chat session: total
  tokens, tool-call counts, and session duration — no `$`, because Cursor's
  logs don't record which model ran each turn.
- **No fabricated depth.** Missing per-turn data renders as absent — never
  synthesized timestamps, usage, or prices. If Cursor starts recording richer
  usage, the adapter can grow with it.

## Where transcripts live

Cursor stores chat history in a SQLite database (`state.vscdb`), read-only:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` |
| Linux | `~/.config/Cursor/User/globalStorage/state.vscdb` |
| Windows | `%APPDATA%\Cursor\User\globalStorage\state.vscdb` |

## Quick start

```sh
npx aireceipts-cli --list     # Cursor sessions appear alongside other agents
npx aireceipts-cli            # newest session across agents
```

## Integration

- **Exact snippets:** `npx aireceipts-cli integrations cursor`.
- No hook/statusline surface exists for Cursor; the CLI is the integration
  point.

## Receipts on your PRs

Cursor sessions join PR attribution under the same conservative rules as every
agent — [how](../pr-receipts.md).

## Privacy

Read-only, local. The database is opened read-only; nothing is written to it
and nothing leaves your machine ([what a receipt proves](../trust.md)).
