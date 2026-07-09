# VHS tape (github.com/charmbracelet/vhs) that produced quickstart.gif.
# Reproduce from a repo checkout after `npm ci && npm run build` — see record.sh
# in this directory for the full sandbox protocol. In short:
#   1. Put an `aireceipts` shim on PATH that execs `node <repo>/dist/cli.js`.
#   2. Point HOME at a scratch dir whose .aireceipts/telemetry.json is
#      {"shown":true} (keeps the first-run notice out of the recording).
#   3. Drop the `clean-multi-tool-2-models` fixture transcript under
#      $HOME/.claude/projects/<project>/<file>.jsonl so the real CLI discovers
#      it as the newest session — no --demo flag involved.
#   4. Export SBOX_HOME / SBOX_BIN, then run: vhs quickstart.tape
Output quickstart.gif
Set FontSize 15
Set Width 620
Set Height 640
Set Padding 24
Set TypingSpeed 55ms

Hide
Type "export AIRECEIPTS_TELEMETRY=off DO_NOT_TRACK=1 HOME=$SBOX_HOME AIRECEIPTS_HOME=$SBOX_HOME PATH=$SBOX_BIN:$PATH"
Enter
Type "clear"
Enter
Show

Sleep 1s
Type "aireceipts"
Sleep 700ms
Enter
Sleep 9s
