# Statusline

`aireceipts statusline` prints one line — the last-completed session's cost (or
tokens, if unpriced) plus a waste flag if one fired — meant for Claude Code's
`statusLine` command config, so a number is visible on every prompt without
running `aireceipts` manually.

## Setup

Add a `statusLine` entry to your Claude Code `settings.json` (global:
`~/.claude/settings.json`, or project-local: `.claude/settings.json`):

```json
{
  "statusLine": {
    "type": "command",
    "command": "aireceipts statusline"
  }
}
```

Claude Code invokes this command on its own schedule and pipes a JSON payload
(including `transcript_path` for the active session) on stdin. `aireceipts`
reads that payload, loads the referenced transcript directly, and prints one
line — no polling, no background process, no daemon.

If `aireceipts` isn't on your `PATH`, use an absolute path to the binary
instead of `aireceipts` in the `command` field (for example, the output of
`which aireceipts`).

## Output

```
[Claude Code] $1.23 · 12k tok
[Claude Code] $2.50 · 20k tok · ⚠ Bash loop ×5
[Cursor] 8k tok
```

- `$X.XX · Nk tok` when the session's cost is priced; `Nk tok` only when it
  isn't (never a fabricated `$` amount).
- The waste flag (`⚠ ...`) appears only when a waste detector actually fired
  on the session — its absence is not itself a claim that nothing was found.
- Outside a piped invocation (or when stdin carries no usable payload),
  `aireceipts statusline` falls back to the most-recently-ended session found
  on disk. If no sessions are detected at all, it prints a neutral placeholder
  line rather than an error, so the statusline layout never breaks.

## Notes

- One line, one on-disk read per invocation — this is a snapshot, not a live
  view. Nothing streams mid-session (see the CLI's non-goals).
- Sessions that can't be priced (missing price rows) render tokens-only —
  `aireceipts` never estimates a dollar figure it can't source to a price row.
- Subagent spend is included (SPEC-0061): background agents write their
  transcripts to separate files under the session's `subagents/` directory,
  and the statusline's `$` and token counts fold that rollup in — the same
  aggregate the session receipt draws as its `SUBAGENTS (N)` row.

## Known limitation: refresh cadence

Claude Code re-invokes the statusline command only when the main conversation
updates. During a long stretch of background-agent work with the main loop
idle, the line is not re-invoked and can sit stale until the next
main-conversation event — that is host behavior, not a rendering bug: every
invocation reads the transcripts fresh.
