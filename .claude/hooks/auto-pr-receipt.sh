#!/bin/bash
# PostToolUse: after a successful `gh pr create`, attach the session receipt
# automatically (SPEC-0019). Fail-safe: never blocks, never errors the tool call.
# Prior art: the maintainer's earlier tooling wired receipts as a git-push hook;
# here PR-creation is the natural moment (the PR exists to comment on).
input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)
case "$cmd" in *"gh pr create"*) ;; *) exit 0;; esac
( node dist/cli.js pr --post 2>/dev/null || npx -y aireceipts pr --post 2>/dev/null ) &
exit 0
