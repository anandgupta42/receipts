# Show a statusline in your shell

Goal: see the current session's cost on *every* Claude Code prompt, without
running a command yourself.

`aireceipts statusline` prints exactly one line, meant to be wired into Claude
Code's `statusLine` config:

```
[aireceipts] $4.20 · $9/hr · 128k · ctx 42% · 5h 24% ↺2h13m
```

![Terminal recording: piping a Claude Code statusLine payload through aireceipts statusline prints one line — session cost, burn rate, tokens, context fullness, a waste flag, and the 5-hour window countdown; --format trims it to chosen segments.](../../site/assets/statusline.gif)

## Set it up

Add a `statusLine` block to your Claude Code `settings.json` — global
(`~/.claude/settings.json`) or project-local (`.claude/settings.json`):

```json
{
  "statusLine": {
    "type": "command",
    "command": "aireceipts statusline"
  }
}
```

Claude Code runs that command on its own schedule and pipes a small JSON payload
on stdin — including the `transcript_path` of the active session. aireceipts reads
that payload, prices the referenced transcript, and prints the line. No polling,
no daemon, one disk read per invocation.

If `aireceipts` isn't on your `PATH`, put the absolute path (the output of `which
aireceipts`) in the `command` field.

Using tmux too? The [terminal-surfaces recipe](../statusline.md#terminal-surfaces)
shows tmux, Starship, raw zsh/bash, OSC terminal-title, and PowerShell patterns
that pass each pane's cwd to `statusline --cwd`, while keeping Claude Code's
richer native stdin hook as the primary setup.

## What the line shows

The default line is the segment set `brand,cost,burn,tokens,context,waste,quota5h`
— cost, burn rate, tokens, context fullness, a waste flag, and your rate-limit
window:

- `$X.XX` is the session's priced cost (`Nk`/`NM` tokens alone when it can't be
  priced — never a fabricated dollar amount), and `$X/hr` its session-average
  burn rate.
- `ctx N%` is how full the current context window is; token counts abbreviate to
  `k`/`M` (`128k`, `1.2M`).
- `5h N% ↺Xh Ym` is your official 5-hour rate-limit usage plus the time until it
  resets — subscribers only, on by default, and dropped when Claude Code doesn't
  provide it.
- A waste flag (`⚠ Bash loop ×5`) appears only when a detector actually fired.
- Outside a piped call, or when the payload carries no session, it falls back to
  the newest session on disk, and prints a neutral placeholder rather than an
  error if there are none — so your statusline layout never breaks.

Pick your own segments with `--format`; the full segment table and the `≈` quota
ETA honesty rules are in [docs/statusline.md](../statusline.md).

## Rate-limit window (`--quota`)

If you're on a Claude Code subscription, `aireceipts --quota` reports your current
rate-limit window when Claude Code provides it on stdin. It runs in statusline
stdin mode only and stays silent when that data isn't available, so it's safe to
include in a statusline command that also prints cost.

## Full reference

The authoritative statusline reference — every output shape and fallback — is
[docs/statusline.md](../statusline.md).

## Next

- **[Install the agent hook](03-install-hook.md)** — a full receipt at session end.
- **[Set a budget](08-budget.md)** — a threshold, not just a number.
