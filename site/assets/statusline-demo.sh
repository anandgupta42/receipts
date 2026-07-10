#!/usr/bin/env bash
# Replays site/assets/meter-demo-session.jsonl as an in-progress agent session
# with the aireceipts meter pinned at the bottom — the statusline.gif driver.
#
# Honesty protocol: every meter line shown is a REAL render — at each step the
# transcript prefix is written to the sandbox session file and the line is
# produced by piping a statusLine payload through the real
# `aireceipts statusline` (the exact mechanics of Claude Code's hook). What is
# transcript-derived vs simulated: cost, tokens, and the waste flag are priced
# from the transcript at that moment; the payload fields the HOST supplies at
# runtime (model name, context %, 5h quota, reset time) are simulated inputs
# with a plausible rising progression, exactly as Claude Code would pipe them.
# The conversation rows above the bar are replayed from the same transcript's
# records; the replay runs through to the session's final turn. Requires
# $SBOX_HOME and $SBOX_BIN (see record.sh).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURE="$HERE/meter-demo-session.jsonl"
SESSION="$SBOX_HOME/.claude/projects/demo-project/session.jsonl"
PAYLOAD="$SBOX_HOME/payload.json"
export PATH="$SBOX_BIN:$PATH"

# Step cut points (line counts into the fixture) with the context/quota the
# payload reports at that moment — rising through the session, ending on the
# values the landing strip quotes.
STEPS_LINES=(24 64 110 132 192)
STEPS_CTX=(12 19 27 34 41)
STEPS_5H=(48 53 58 61 63)

ACTIVITY_ROWS=10   # conversation rows shown above the bar (fixed → bar never moves)

activity() { # $1 = prefix line count; prints the last $ACTIVITY_ROWS rows in Claude Code's transcript shape (⏺ tool row + ⎿ result row)
  node -e '
    const fs = require("fs");
    const n = Number(process.argv[2]);
    const lines = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).slice(0, n);
    const G = "\x1b[32m", D = "\x1b[2m", R = "\x1b[0m";
    const rows = [];
    let pendingResult = null;
    for (const l of lines) {
      const r = JSON.parse(l);
      if (r.type === "user" && typeof r.message.content === "string") {
        rows.push(D + ">" + R + " " + r.message.content);
      } else if (r.type === "user" && Array.isArray(r.message.content)) {
        const tr = r.message.content.find((c) => c.type === "tool_result");
        if (tr && pendingResult) { rows.push(D + "  ⎿  " + String(tr.content).split("\n")[0] + R); pendingResult = null; }
      } else if (r.type === "assistant") {
        const tu = (r.message.content || []).find((c) => c.type === "tool_use");
        if (tu) {
          const arg = tu.input.command || tu.input.file_path || tu.input.pattern || "";
          rows.push(G + "⏺" + R + " " + tu.name + "(" + arg + ")");
          pendingResult = true;
        } else {
          rows.push(G + "⏺" + R + " All suites green; summarizing the fix.");
        }
      }
    }
    const shown = rows.slice(-Number(process.argv[3]));
    while (shown.length < Number(process.argv[3])) shown.push("");
    console.log(shown.join("\n"));
  ' "$FIXTURE" "$1" "$ACTIVITY_ROWS"
}

# Claude Code's bottom chrome: the bordered input box, then the statusline
# under it. The meter line is rendered on a highlighted band so the demo's eye
# lands on the bar — presentational staging only; the TEXT is the CLI's exact
# output bytes.
BOX_W=79
input_box() {
  printf '\033[2m╭%s╮\033[0m\n' "$(printf '─%.0s' $(seq 1 $BOX_W))"
  printf '\033[2m│\033[0m > %*s\033[2m│\033[0m\n' "$(( BOX_W - 3 ))" ''
  printf '\033[2m╰%s╯\033[0m\n' "$(printf '─%.0s' $(seq 1 $BOX_W))"
}

for i in "${!STEPS_LINES[@]}"; do
  head -n "${STEPS_LINES[$i]}" "$FIXTURE" > "$SESSION"
  node -e '
    const now = Date.now();
    const payload = {
      transcript_path: process.argv[1],
      model: { id: "claude-opus-4-8", display_name: "Opus" },
      context_window: { used_percentage: Number(process.argv[3]) },
      rate_limits: {
        five_hour: { used_percentage: Number(process.argv[4]), resets_at: Math.floor((now + 2 * 3600_000 + 13 * 60_000) / 1000) },
        seven_day: { used_percentage: 22, resets_at: Math.floor((now + 3 * 86_400_000) / 1000) },
      },
    };
    require("fs").writeFileSync(process.argv[2], JSON.stringify(payload) + "\n");
  ' "$SESSION" "$PAYLOAD" "${STEPS_CTX[$i]}" "${STEPS_5H[$i]}"
  METER="$(aireceipts statusline < "$PAYLOAD")"
  clear
  activity "${STEPS_LINES[$i]}"
  if [ "$i" -lt "$(( ${#STEPS_LINES[@]} - 1 ))" ]; then
    printf '\033[38;5;173m✻\033[0m \033[2mWorking… (esc to interrupt)\033[0m\n'
  else
    printf '\n'
  fi
  input_box
  printf '\033[1m\033[48;5;236m %s \033[0m\n' "$METER"
  if [ "$i" -eq "$(( ${#STEPS_LINES[@]} - 1 ))" ]; then
    printf '\033[38;5;173m └ the meter — aireceipts statusline, one settings line\033[0m\n'
  fi
  sleep 1.7
done
sleep 3.5
