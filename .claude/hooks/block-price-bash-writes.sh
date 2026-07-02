#!/usr/bin/env bash
# PreToolUse hook (UX layer): best-effort guard against Bash commands that write
# into data/prices/** (echo >>, sed -i, tee, mv/cp targets, redirection), which
# would bypass the Edit/Write citation hook. CI's cite-check job remains the
# authoritative gate; this catches the obvious sidesteps early.

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

payload="$(cat)"
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty')"

[ -z "$cmd" ] && exit 0

# Reading price files is fine; block only when the command both mentions
# data/prices/ and looks like a write (redirect, in-place edit, copy/move/tee).
if printf '%s' "$cmd" | grep -q 'data/prices/' &&
   printf '%s' "$cmd" | grep -Eq '(>>?[[:space:]]*[^|]*data/prices/|sed[[:space:]].*-i|tee[[:space:]]+[^|]*data/prices/|(mv|cp)[[:space:]]+[^|]*data/prices/[^[:space:]]*\.json)'; then
  echo "BLOCKED: shell writes into data/prices/** bypass the citation gate (I2/I3)." >&2
  echo "Edit price files via the Edit/Write tools with a cited 'sources' entry," >&2
  echo "or use the update-prices skill. CI cite-check will reject uncited rows anyway." >&2
  exit 2
fi

exit 0
