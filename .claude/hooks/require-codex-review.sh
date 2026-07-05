#!/bin/bash
# PreToolUse gate: canonical maintainer checkouts require an independent review of
# CURRENT HEAD before publishing or merging. The review step writes HEAD's sha to
# .review-ok; any new commit invalidates it. Fork contributors do not need this
# repo-local Claude Code marker; public enforcement is CI + maintainer review.

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

payload=$(cat)
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""' 2>/dev/null)
case "$cmd" in
  *"gh pr create"*|*"gh pr merge"*) ;;
  *"git push"*)
    # pushes of feature branches carry PR commits — same review requirement; main is chore-lane
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    [ "$branch" = "main" ] && exit 0
    ;;
  *) exit 0 ;;
esac

origin_url=$(git remote get-url --push origin 2>/dev/null || git remote get-url origin 2>/dev/null || true)
case "$origin_url" in
  git@github.com:anandgupta42/receipts.git|git@github.com:anandgupta42/receipts|https://github.com/anandgupta42/receipts.git|https://github.com/anandgupta42/receipts|ssh://git@github.com/anandgupta42/receipts.git) ;;
  *)
    if [ "${AIRECEIPTS_REQUIRE_REVIEW_MARKER:-}" != "1" ]; then
      exit 0
    fi
    ;;
esac

head=$(git rev-parse HEAD 2>/dev/null)
ok=$(cat .review-ok 2>/dev/null)
if [ -n "$head" ] && [ "$head" = "$ok" ]; then exit 0; fi
echo "BLOCKED: no independent review recorded for HEAD ($head)." >&2
echo "Maintainer harness checkouts require a .review-ok marker before publish/merge." >&2
echo "Run review-pr with an independent critic (Codex preferred when available), fix accepted findings, then:" >&2
echo "  git rev-parse HEAD > .review-ok" >&2
echo "Fork contributors do not need this local marker; see CONTRIBUTING.md." >&2
exit 2
