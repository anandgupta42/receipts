#!/bin/bash
# SessionStart: keep the receipt pipeline's first link alive. The pre-push hook
# (.githooks/pre-push) is what pushes refs/aireceipts/<slug>; it only runs if
# core.hooksPath resolves to a directory that actually contains it.
#
# Failure mode this repairs (2026-07-13 incident): an ABSOLUTE hooksPath welds
# every worktree to one checkout's working tree. If that checkout sits on a
# branch predating .githooks/pre-push, NO worktree runs the hook and receipts
# silently stop attaching. A RELATIVE value resolves per-worktree.
#
# Safety (Codex review, 2026-07-13): every git call is bound to
# $CLAUDE_PROJECT_DIR, never the session cwd, so this can only ever touch the
# repo that ships this script. Only two values are repaired: unset, and an
# absolute ".githooks" variant (our own convention gone stale). Any other
# value is a deliberate hooks manager (husky, a central dispatcher): warn,
# never overwrite. Fail-safe: never blocks the session, always exits 0.
root="${CLAUDE_PROJECT_DIR:-}"
[ -n "$root" ] || exit 0
# Operate only on a checkout of this repo: the tracked hook must be present.
[ -f "$root/.githooks/pre-push" ] || exit 0
git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

current=$(git -C "$root" config core.hooksPath 2>/dev/null)
case "$current" in
  ".githooks") ;; # healthy
  "" | */.githooks)
    git -C "$root" config core.hooksPath .githooks 2>/dev/null || true
    if [ "$(git -C "$root" config core.hooksPath 2>/dev/null)" = ".githooks" ]; then
      echo "aireceipts: repaired core.hooksPath ('${current:-unset}' -> '.githooks')"
    else
      echo "aireceipts: WARNING: could not repair core.hooksPath (still '${current:-unset}'); branch pushes may not attach receipt refs"
    fi
    ;;
  *)
    echo "aireceipts: NOTE: core.hooksPath is '$current' (a custom hooks setup, left untouched); the receipt pre-push hook in .githooks will not run"
    ;;
esac

hooks_dir=$(git -C "$root" rev-parse --git-path hooks 2>/dev/null)
case "$hooks_dir" in
  "") ;;
  /*) ;;
  *) hooks_dir="$root/$hooks_dir" ;;
esac
if [ -n "$hooks_dir" ] && [ ! -x "$hooks_dir/pre-push" ]; then
  echo "aireceipts: WARNING: no executable pre-push at '$hooks_dir'; branch pushes will not attach receipt refs"
fi
exit 0
