#!/bin/bash
# PreToolUse gate: `gh pr create` requires a Codex review of the CURRENT HEAD.
# The review step (review-pr skill / codex exec) writes HEAD's sha to .review-ok;
# any new commit invalidates it. Exit 2 blocks the tool call with guidance.
cmd=$(jq -r '.tool_input.command // ""' 2>/dev/null)
case "$cmd" in *"gh pr create"*|*"gh pr merge"*) ;; *"git push"*)
  # pushes of feature branches carry PR commits — same review requirement; main is chore-lane
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  [ "$branch" = "main" ] && exit 0 ;; *) exit 0;; esac
head=$(git rev-parse HEAD 2>/dev/null)
ok=$(cat .review-ok 2>/dev/null)
if [ -n "$head" ] && [ "$head" = "$ok" ]; then exit 0; fi
echo "BLOCKED: no Codex review recorded for HEAD ($head). Run the review-pr skill via codex against this diff, fix accepted findings, then: git rev-parse HEAD > .review-ok — and retry." >&2
exit 2
