# Receipts for Cursor

**Honest degraded mode: session totals only.** Cursor's local history carries
no per-turn usage records, so a Cursor receipt shows the session's total
tokens — never per-tool rows, never per-turn model splits, and dollars only
when the whole session resolves to one priced model. aireceipts states what it
can prove and nothing more (I2/I3). (SPEC-0058; depth facts match
`src/parse/cursor.ts`.)

## What you get

- **Session totals.** One receipt per Cursor chat session: total tokens, the
  session's model when recorded, duration, and a priced total only when a
  cited price row matches.
- **No fabricated depth.** Missing per-turn data renders as absent — not
  estimated. If Cursor starts recording richer usage, the adapter can grow
  with it.

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
