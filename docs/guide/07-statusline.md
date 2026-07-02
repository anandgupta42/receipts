# Show a statusline in your shell

Goal: see the current session's cost on *every* Claude Code prompt, without
running a command yourself.

`aireceipts statusline` prints exactly one line, meant to be wired into Claude
Code's `statusLine` config:

```
[Claude Code] $0.18 · 147k tok
```

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

## What the line shows

- `$X.XX · Nk tok` when the session is priced; `Nk tok` alone when it isn't —
  never a fabricated dollar amount.
- A waste flag (`⚠ Bash loop ×5`) appears only when a detector actually fired.
- Outside a piped call, or when the payload carries no session, it falls back to
  the newest session on disk, and prints a neutral placeholder rather than an
  error if there are none — so your statusline layout never breaks.

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
