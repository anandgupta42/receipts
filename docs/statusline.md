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
[aireceipts] $4.20 · $9/hr · 128k · ctx 42% · 5h 24% ↺2h13m
[aireceipts] $2.50 · $6/hr · 20k · ⚠ Bash loop ×5 · 5h 41% ↺58m
[aireceipts · Cursor] 8k
```

- `$X.XX` is the session's priced cost (aireceipts' own cited-price figure, incl.
  subagents); omitted when it can't be priced — never a fabricated `$` amount.
- `$X/hr` is the session-average burn rate (that same priced cost over the session
  wall-clock); omitted when the session isn't priced or has no duration yet.
- `Nk` / `NM` is the session's token count, abbreviated (`12k`, `1.2M`, `501M`).
- `ctx N%` is how full the current context window is — Claude Code's own
  pre-calculated `context_window.used_percentage`, omitted when the payload lacks it.
- `5h N% ↺Xh Ym` is your official 5-hour rate-limit usage (Claude Code's own
  `rate_limits.five_hour.used_percentage`, subscribers only) plus the time until the
  window resets, derived from the real `resets_at` — the countdown is dropped (leaving
  `5h N%`) when `resets_at` is absent or already past, never a guessed time.
- The waste flag (`⚠ ...`) appears only when a waste detector actually fired
  on the session — its absence is not itself a claim that nothing was found.
- Outside a piped invocation (or when stdin carries no usable payload),
  `aireceipts statusline` falls back to the most-recently-ended session found
  on disk — the prefix then names whose session it is (`[aireceipts · Codex]`).
  If no sessions are detected at all, it prints a neutral placeholder line
  rather than an error, so the statusline layout never breaks.

## Custom formats (`--format`)

The default line is the format `brand,cost,burn,tokens,context,waste,quota5h`. Pick your own
segments with `--format` (comma-separated; a segment with nothing honest to say
is omitted, and an unknown name exits 1 with the valid list on stderr):

```json
{
  "statusLine": {
    "type": "command",
    "command": "aireceipts statusline --format brand,cost,quota5h,quotaEta"
  }
}
```

| Segment | Renders | Source |
|---|---|---|
| `brand` | `[aireceipts]` (stdin) / `[aireceipts · <agent>]` (disk fallback) | — |
| `cost` | `$X.XX` | priced session total incl. subagents; omitted when unpriced (I2) |
| `burn` | `$X/hr` | session-average burn (priced cost ÷ wall-clock); omitted when unpriced or no duration |
| `tokens` | `Nk` / `NM` | session + subagent tokens, abbreviated |
| `context` | `ctx N%` | Claude Code's `context_window.used_percentage` (stdin only) |
| `waste` | `⚠ ...` | first fired waste detector |
| `quota5h` / `quota7d` | `5h N% ↺Xh Ym` / `7d N% ↺…` | official `rate_limits` passthrough + reset countdown (stdin only) |
| `quotaEta` | `≈ 5h cap HH:MM UTC` | labeled arithmetic, see below |

### `quotaEta` honesty rules

The ETA is straight-line arithmetic between exactly two observed readings of
your 5h window (the previous invocation's, cached in
`~/.aireceipts/quota-window.json`, and this one's) — the `≈` label is
mandatory, and the segment renders **only** when every guard holds: same window
(unchanged `resets_at`), rising usage, readings at least 60s apart, no
clock-skew between them, and the projected crossing landing before the window
resets. Anything ambiguous renders nothing — an omitted segment, never a
guessed time. It is an extrapolation of your recent burn rate, not a
prediction of what you'll do next.

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
