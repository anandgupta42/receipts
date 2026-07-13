#!/bin/bash
# SessionStart: keep the receipt pipeline's first link alive. The pre-push hook
# (.githooks/pre-push) is what pushes refs/aireceipts/<slug>; it only runs if
# core.hooksPath resolves to a directory that actually contains it.
#
# Failure mode this repairs (2026-07-13 incident): an ABSOLUTE hooksPath welds
# every worktree to the main checkout's working tree — if that checkout sits on
# a branch predating .githooks/pre-push, NO worktree runs the hook and receipts
# silently stop attaching. A RELATIVE value resolves per-worktree, so each
# checkout uses its own tracked hook.
#
# Fail-safe: never blocks the session, always exits 0.
current=$(git config core.hooksPath 2>/dev/null)
if [ "$current" != ".githooks" ]; then
  git config core.hooksPath .githooks 2>/dev/null || true
  echo "aireceipts: repaired core.hooksPath ('${current:-unset}' -> '.githooks')"
fi
hook_dir=$(git rev-parse --git-path hooks 2>/dev/null)
if [ -n "$hook_dir" ] && [ ! -x "$hook_dir/pre-push" ]; then
  echo "aireceipts: WARNING — no executable pre-push at '$hook_dir'; branch pushes will not attach receipt refs (this checkout may predate .githooks/pre-push)"
fi
exit 0
