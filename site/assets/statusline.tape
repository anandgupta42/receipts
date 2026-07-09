# VHS tape (github.com/charmbracelet/vhs) that produced statusline.gif.
# Reproduce from a repo checkout after `npm ci && npm run build` — see record.sh
# in this directory for the full sandbox protocol. In short:
#   1. Put an `aireceipts` shim on PATH that execs `node <repo>/dist/cli.js`.
#   2. Point HOME at a scratch dir whose .aireceipts/telemetry.json is
#      {"shown":true} (keeps the first-run notice out of the recording).
#   3. Write a realistic Claude Code statusLine stdin payload to
#      $SBOX_HOME/payload.json (context_window + rate_limits, with resets_at
#      timestamps computed relative to "now" so the countdown is never stale).
#   4. Export SBOX_HOME / SBOX_BIN, then run: vhs statusline.tape
# The typed commands are the REAL command a user runs (piping the payload
# in) — no shell alias shortcuts, since a demo GIF's typed command is a claim
# about what users actually run.
Output statusline.gif
Set FontSize 14
Set Width 1040
Set Height 260
Set Padding 24
Set TypingSpeed 55ms

Hide
Type "export AIRECEIPTS_TELEMETRY=off DO_NOT_TRACK=1 HOME=$SBOX_HOME AIRECEIPTS_HOME=$SBOX_HOME PATH=$SBOX_BIN:$PATH"
Enter
Type "cd $SBOX_HOME"
Enter
Type "clear"
Enter
Show

Sleep 600ms
Type "cat payload.json | aireceipts statusline"
Sleep 500ms
Enter
Sleep 1.8s
Type "cat payload.json | aireceipts statusline --format brand,cost,waste"
Sleep 500ms
Enter
Sleep 3.5s
