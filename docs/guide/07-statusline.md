# Keep the meter running

Goal: the meter on *every* Claude Code prompt — model, observable cost floor, floor burn
rate — without running a command yourself.

`aireceipts statusline` prints exactly one line, meant to be wired into Claude
Code's `statusLine` config:

```
[aireceipts] Opus · ≥$4.20 · ≥$9/hr · 128k · ctx 42% · 5h 24% ↺2h13m
```

![An agent session replayed in a Claude Code-shaped terminal — tool rows scrolling above the input box, the aireceipts meter highlighted beneath it, ticking up as the session runs; host-supplied payload fields simulated.](../../site/assets/statusline.gif)

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
that payload, computes the referenced transcript's Standard-API floor, and prints the line. No polling,
no daemon, one disk read per invocation.

If `aireceipts` isn't on your `PATH`, put the absolute path (the output of `which
aireceipts`) in the `command` field.

## In tmux or another shell (Codex, opencode)

The statusline is not Claude-Code-only. Any terminal surface that can run a
command shows it — which is how Codex and opencode sessions get a live floor
line. With `aireceipts` installed globally, add to `~/.tmux.conf`:

```tmux
set -g status-right '#(aireceipts statusline --cwd "#{pane_current_path}")'
```

Each pane shows its own session's cost. To get the bar automatically every
time you launch the agent — without living in tmux full-time — see the
[shell-wrapper recipe](../statusline.md#make-the-bar-appear-whenever-you-launch-your-agent)
(a `codex()` function that starts tmux on demand). Starship, raw zsh/bash,
PowerShell, and OSC terminal-title recipes — plus the path-matching rules —
are in the [terminal-surfaces reference](../statusline.md#terminal-surfaces). For Claude
Code itself, the native stdin hook above stays the richer, recommended setup.

## What the line shows

The default line is the segment set `brand,model,cost,burn,tokens,context,waste,quota5h`
— the model, observable floor, floor rate, tokens, context fullness, a heuristic-pattern flag, and your
rate-limit window:

- `Opus` (after the brand) is the model — in stdin mode, Claude Code's own current
  model name (a mid-session switch shows on the next render); in disk fallback, the
  session's dominant model by token share. Omitted when neither is known.
- `≥$X.XX` is the session's observable Standard-API list-price-equivalent floor
  (`Nk`/`NM` tokens alone when no cited row matches), and `≥$X/hr` is that
  floor divided by elapsed session time. Neither is an invoice or exact charge;
  both are rounded down for display.
- `ctx N%` is how full the current context window is; token counts abbreviate to
  `k`/`M` (`128k`, `1.2M`).
- `5h N% ↺Xh Ym` is your official 5-hour rate-limit usage plus the time until it
  resets — subscribers only, on by default, and dropped when Claude Code doesn't
  provide it.
- A heuristic-pattern flag (`⚠ Bash loop ×5`) appears only when a detector
  fired; it is evidence to inspect, not proven waste or savings.
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
