# VHS tape (github.com/charmbracelet/vhs) that produced statusline.gif.
# Reproduce from a repo checkout after `npm ci && npm run build` — see record.sh
# in this directory for the full sandbox protocol (SBOX_HOME / SBOX_BIN).
#
# What this shows: an agent session IN PROGRESS with the meter pinned at the
# bottom — the way `aireceipts statusline` actually appears in Claude Code's
# status bar. It is driven by statusline-demo.sh, which replays
# meter-demo-session.jsonl into the sandbox turn by turn; after each chunk the
# meter line is produced by piping a statusLine payload through the REAL
# `aireceipts statusline` binary (the same mechanics as Claude Code's hook).
# Cost, tokens, and the waste flag are genuine renders of the transcript state
# at each step; the host-supplied payload fields (model, context %, quota,
# reset) are simulated inputs, as Claude Code would pipe them. The activity
# rows are replayed from the transcript's own records, through to the
# session's final turn.
Output statusline.gif
Set FontSize 14
Set Width 1040
Set Height 360
Set Padding 24
Set TypingSpeed 55ms

Hide
Type "export AIRECEIPTS_TELEMETRY=off DO_NOT_TRACK=1 HOME=$SBOX_HOME AIRECEIPTS_HOME=$SBOX_HOME"
Enter
Type "clear"
Enter
Type "./statusline-demo.sh"
Enter
Sleep 1.2s
Show

Sleep 13s
