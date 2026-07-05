# Troubleshooting & FAQ

Symptom first. Find what you're seeing, then the fix.

## "no agent session data detected"

```
no agent session data detected. Looked in:
~/.claude/projects, ~/.codex/sessions, ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb, ~/.gemini/tmp, ~/.local/share/opencode
```

aireceipts found no transcripts in any of the places it looks. The message lists
those places verbatim, so the fix is usually one of:

- **You haven't run a session yet.** Run your agent once, then try again — the
  receipt is built from the transcript it writes to disk.
- **Your agent stores logs elsewhere.** aireceipts reads the default locations
  above. Claude Code honors `$CLAUDE_CONFIG_DIR`: if you've set it, aireceipts
  reads `$CLAUDE_CONFIG_DIR/projects` instead of `~/.claude/projects`.
- **The files aren't readable.** aireceipts silently skips a transcript it can't
  read (wrong owner, restrictive mode) rather than erroring on it. If a directory
  is present but its sessions don't show up, check the file permissions.

The default receipt exits non-zero with this message; `--list` prints the same
message and exits `0`.

## `no session matched "…"`

```
no session matched "does-not-exist-xyz"
```

Your selector — an index, a session id, or a title substring — matched nothing.
Run `aireceipts --list` to see the exact titles and their 1-based indices, then
select by an index or a substring you can see in the list. See
[Read a receipt](04-read-a-receipt.md#pick-a-different-session).

## The receipt shows tokens, not dollars

This is a **feature, not a bug.** When a session ran on a model that has no cited,
dated price row, aireceipts prints the token counts and `no price table matched` —
it never guesses a dollar figure it can't source:

```
--------------------------------------------------
TOTAL....................................3,325 tok
no price table matched
```

The whole tool rests on never printing a fabricated dollar. A tokens-only receipt
means "I won't invent a number," not "something failed." Add a price for the model
(one cited PR) and it prices from then on. Why, and how pricing works:
[How pricing is estimated](13-pricing.md).

## A one-time note about diagnostics on first run

The very first time you run aireceipts, it prints this once:

```
aireceipts sends anonymous, content-free diagnostics and feature-usage events (command, coarse buckets, and a random install identifier — never transcript content, prompts, file paths, repo names, or dollar amounts). Disable anytime with AIRECEIPTS_TELEMETRY=off or DO_NOT_TRACK=1. Run --telemetry-show to see exactly what a run would send. Details: docs/telemetry.md
```

It never prints again after that. To turn telemetry off entirely (zero network
calls — not "less," zero), set either environment variable:

```sh
export AIRECEIPTS_TELEMETRY=off      # or DO_NOT_TRACK=1
```

To see exactly what a run would send — and send nothing — run `aireceipts
--telemetry-show`. Full detail: [docs/telemetry.md](../telemetry.md).

## Turn off the automatic session-end receipt

If you ran `install-hook` and want it gone:

```sh
aireceipts uninstall-hook
```

```
Removed the aireceipts SessionEnd hook.
```

It removes only the aireceipts hook and leaves your other Claude Code settings
untouched. See [Install the agent hook](03-install-hook.md).

## The week total didn't change

`aireceipts week` covers a moving window — the trailing seven days ending now — and
buckets each session by when it *ended*. A session older than seven days, or one
with no recorded end time, won't appear. To inspect a fixed span, pin it with
`--since <date>` (see [Aggregate the week](06-week.md#pin-the-window-with-since)).

## Next

- **[How pricing is estimated](13-pricing.md)** — why a number can be tokens-only, or differ from your bill.
- **[How session attribution works](14-session-attribution.md)** — why a session looks split or missing.
