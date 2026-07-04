# Install the agent hook

Goal: get a short receipt automatically, every time a Claude Code session ends,
without running a command yourself.

> **Claude Code only, today.** The `install-hook` command wires into Claude
> Code's `SessionEnd` hook. Other agents (Codex, Cursor, opencode) are fully
> supported for *reading* receipts — see [Read a receipt](04-read-a-receipt.md) —
> but don't yet have an equivalent auto-install. For those, run `aireceipts`
> yourself or add it to your own shell/CI flow.

For PR receipts across any supported coding assistant, use the universal finalizer
instead: `npx aireceipts pr --post` from the repo worktree. This Claude hook is optional
convenience for end-of-session mini receipts, not the PR workflow.

## Install

```sh
aireceipts install-hook
```

It never writes silently. It prints the exact change, then asks:

```
aireceipts will add a SessionEnd hook to ~/.claude/settings.json:

+ {
+   "hooks": {
+     "SessionEnd": [
+       {
+         "matcher": "*",
+         "hooks": [
+           {
+             "type": "command",
+             "command": "npx aireceipts --mini",
+             "timeout": 10
+           }
+         ]
+       }
+     ]
+   }
+ }

(Existing settings are preserved; formatting may be normalized to 2-space JSON.)

Apply this change? [y/N] y
Installed. A 6-line receipt now prints when a Claude Code session ends (`npx aireceipts --mini`).
```

Answer anything other than `y` and it makes no change. Your other Claude Code
settings are merged, not overwritten.

Now, whenever a Claude Code session ends, you'll see the mini receipt:

```
aireceipts · session receipt
Claude Code · claude-opus-4-8 · 10m 30s
total  $0.18
top    Bash · $0.05 (3 calls)
no waste detected
run  aireceipts  for the full receipt
```

## Where it writes

The hook lands in your Claude Code `settings.json` — `~/.claude/settings.json` by
default, or wherever `$CLAUDE_CONFIG_DIR` points. It runs `npx aireceipts --mini`,
capped at a 10-second timeout, so a slow run can never hold up your shell.

## Uninstall

```sh
aireceipts uninstall-hook
```

```
Removed the aireceipts SessionEnd hook.
```

It removes only the aireceipts hook and leaves the rest of your settings intact.

## Next

- **[Show a statusline](07-statusline.md)** — cost on *every* prompt, not just at session end.
- **[Read a receipt](04-read-a-receipt.md)** — the full receipt behind the mini one.
