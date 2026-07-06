# VHS tape (github.com/charmbracelet/vhs) that produced demo.gif.
# Reproduce from a repo checkout after `npm ci && npm run build`:
#   1. Put an `aireceipts` shim on PATH that execs `node <repo>/dist/cli.js`.
#   2. Point AIRECEIPTS_HOME at a scratch dir whose .aireceipts/telemetry.json
#      is {"shown":true} (keeps the first-run notice out of the recording).
#   3. Export those as DEMO_BIN / DEMO_HOME, then run: vhs site/assets/demo.tape
Output demo.gif
Set FontSize 15
Set Width 620
Set Height 640
Set Padding 24
Set TypingSpeed 55ms
Hide
Type "export AIRECEIPTS_TELEMETRY=off AIRECEIPTS_HOME=$DEMO_HOME PATH=$DEMO_BIN:$PATH"
Enter
Type "clear"
Enter
Show
Sleep 600ms
Type "aireceipts --demo"
Sleep 700ms
Enter
Sleep 6s
