#!/usr/bin/env bash
# PreToolUse hook: block Edit/Write on data/prices/** unless the new content
# includes a "sources" citation. Enforces I2/I3 (AGENTS.md) mechanically —
# no price row lands without a citable source, ever.
#
# Contract: reads the tool-call JSON payload on stdin, inspects
# .tool_input.file_path and .tool_input.content (Write) /
# .tool_input.new_string (Edit). Exit 2 blocks the tool call.

set -euo pipefail

payload="$(cat)"

file_path="$(printf '%s' "$payload" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/')"

# Only guard files under data/prices/.
case "$file_path" in
  */data/prices/*|data/prices/*) ;;
  *) exit 0 ;;
esac

# Never guard the README — it documents the schema, not price data.
case "$file_path" in
  */data/prices/README.md|data/prices/README.md) exit 0 ;;
esac

if printf '%s' "$payload" | grep -qi '"sources"'; then
  exit 0
fi

echo "BLOCKED: edit to $file_path has no 'sources' citation." >&2
echo "Every data/prices/** row change needs a cited source URL (I3, AGENTS.md)." >&2
echo "Use the update-prices skill, which fetches and cites a real vendor page." >&2
exit 2
