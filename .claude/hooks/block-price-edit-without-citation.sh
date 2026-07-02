#!/usr/bin/env bash
# PreToolUse hook (UX layer): block Edit/Write/MultiEdit on data/prices/** unless
# the proposed content carries a non-empty "sources" citation. Enforces I2/I3
# (AGENTS.md) at the tool level. The authoritative gate is CI's cite-check job —
# this hook exists to fail fast, not to be the source of truth.
#
# Contract: tool-call JSON on stdin; exit 2 blocks the tool call.

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  # No jq available: don't hard-block on a missing dependency; CI still enforces.
  exit 0
fi

payload="$(cat)"

file_path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')"

# Only guard files under data/prices/, and never the schema README.
case "$file_path" in
  */data/prices/README.md|data/prices/README.md) exit 0 ;;
  */data/prices/*|data/prices/*) ;;
  *) exit 0 ;;
esac

# Proposed content: Write -> .content; Edit -> .new_string; MultiEdit -> .edits[].new_string.
proposed="$(printf '%s' "$payload" | jq -r '
  [.tool_input.content // empty,
   .tool_input.new_string // empty,
   ((.tool_input.edits // []) | map(.new_string // empty) | join("\n"))]
  | join("\n")')"

# Accept when the proposed JSON content declares a non-empty sources array with a
# url field. Try strict JSON first (Write of a whole file), fall back to a
# textual check for partial edits where the fragment alone isn't valid JSON.
if printf '%s' "$proposed" | jq -e '
     [.. | objects | select(has("sources")) | .sources]
     | flatten | map(select(type == "object" and (.url // "") != "")) | length > 0
   ' >/dev/null 2>&1; then
  exit 0
fi
if printf '%s' "$proposed" | grep -q '"sources"' && printf '%s' "$proposed" | grep -q '"url"'; then
  exit 0
fi

echo "BLOCKED: edit to $file_path has no non-empty 'sources' citation (url required)." >&2
echo "Every data/prices/** row change needs a cited source URL (I2/I3, AGENTS.md)." >&2
echo "Use the update-prices skill, which fetches and cites a real vendor page." >&2
exit 2
