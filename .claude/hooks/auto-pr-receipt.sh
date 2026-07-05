#!/bin/bash
# PostToolUse: after a successful `gh pr create`, attach the session receipt
# automatically in maintainer harness checkouts (SPEC-0019). Fail-safe: never
# blocks, never errors the tool call. Fork contributors run the command manually.
# Prior art: the maintainer's earlier tooling wired receipts as a git-push hook;
# here PR-creation is the natural moment (the PR exists to comment on).
# Auto-posting is EXPLICIT LOCAL OPT-IN (see require-codex-review.sh), never
# inferred from the remote:  git config --local aireceipts.maintainerHarness true
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)
case "$cmd" in *"gh pr create"*) ;; *) exit 0;; esac

if [ "$(git config --bool --get aireceipts.maintainerHarness 2>/dev/null || true)" != "true" ] \
   && [ "${AIRECEIPTS_AUTO_PR_RECEIPT:-}" != "1" ]; then
  exit 0
fi

( node dist/cli.js pr --post 2>/dev/null || npx -y aireceipts-cli pr --post 2>/dev/null ) &
exit 0
