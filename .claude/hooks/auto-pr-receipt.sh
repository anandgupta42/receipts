#!/bin/bash
# PostToolUse: after a successful `gh pr create`, attach the session receipt
# automatically in canonical maintainer checkouts (SPEC-0019). Fail-safe: never
# blocks, never errors the tool call. Fork contributors can run the command manually.
# Prior art: the maintainer's earlier tooling wired receipts as a git-push hook;
# here PR-creation is the natural moment (the PR exists to comment on).
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)
case "$cmd" in *"gh pr create"*) ;; *) exit 0;; esac

origin_url=$(git remote get-url --push origin 2>/dev/null || git remote get-url origin 2>/dev/null || true)
case "$origin_url" in
  git@github.com:anandgupta42/receipts.git|git@github.com:anandgupta42/receipts|https://github.com/anandgupta42/receipts.git|https://github.com/anandgupta42/receipts|ssh://git@github.com/anandgupta42/receipts.git) ;;
  *)
    if [ "${AIRECEIPTS_AUTO_PR_RECEIPT:-}" != "1" ]; then
      exit 0
    fi
    ;;
esac

( node dist/cli.js pr --post 2>/dev/null || npx -y aireceipts-cli pr --post 2>/dev/null ) &
exit 0
