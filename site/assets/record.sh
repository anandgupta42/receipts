#!/usr/bin/env bash
# Reproduces quickstart.gif, waste-handoff.gif, statusline.gif from a fresh
# aireceipts checkout. Run from anywhere; pass the repo path as $1 if it's not
# the default below.
#
# Sandbox protocol (same convention the retired demo.tape used, extended for
# real session discovery instead of --demo):
#   - dist/ + data/ are copied out of the repo so this directory is a
#     self-contained recording rig; node_modules is SYMLINKED back into the
#     repo's install because the built CLI bundle still imports external deps
#     (e.g. zod) at runtime — it is not a self-contained bundle.
#   - bin/aireceipts is a PATH shim that execs `node dist/cli.js "$@"`.
#   - Each tape gets its OWN sandbox HOME (sbox-quickstart / sbox-handoff /
#     sbox-statusline) rather than sharing one, because aireceipts' default
#     session selection is "newest session wins" — putting both fixtures in
#     one HOME would always pick the newer (clean) one and the loop fixture
#     would never be reachable without an explicit selector.
#   - $SBOX_HOME/.aireceipts/telemetry.json = {"shown":true} suppresses the
#     first-run telemetry notice. AIRECEIPTS_HOME must point at the sandbox
#     home itself (the PARENT of .aireceipts), not at .aireceipts directly —
#     the code joins ".aireceipts/telemetry.json" onto it internally.
#   - HOME is also overridden (not just AIRECEIPTS_HOME) so the real
#     ClaudeCodeAdapter finds the fixture transcript under
#     $HOME/.claude/projects/<project>/<file>.jsonl.
#   - AIRECEIPTS_TELEMETRY=off and DO_NOT_TRACK=1 keep telemetry from ever
#     touching the network, on top of the "shown":true notice suppression.
#   - Every tape's Hidden block does all of this, so no absolute path from
#     the recording machine (HOME, repo checkout, or this scratch dir) is
#     ever typed into a Shown terminal frame.
set -euo pipefail

OUT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${1:-$(cd "$OUT/../.." && pwd)}"   # default: the checkout this script lives in (site/assets/../..)

if ! command -v vhs >/dev/null 2>&1; then
  echo "vhs not found on PATH (brew install vhs)" >&2
  exit 1
fi

echo "== building repo (npm ci && npm run build) =="
(cd "$REPO" && npm ci && npm run build)

echo "== staging dist/ + data/, symlinking node_modules =="
rm -rf "$OUT/dist" "$OUT/data" "$OUT/node_modules"
cp -R "$REPO/dist" "$OUT/dist"
cp -R "$REPO/data" "$OUT/data"
ln -s "$REPO/node_modules" "$OUT/node_modules"

echo "== writing PATH shim =="
mkdir -p "$OUT/bin"
NODE_BIN="$(command -v node)"
cat > "$OUT/bin/aireceipts" <<EOF
#!/bin/sh
exec "$NODE_BIN" "$OUT/dist/cli.js" "\$@"
EOF
chmod +x "$OUT/bin/aireceipts"

make_sbox() {
  local sbox="$1" fixture="$2"
  rm -rf "$sbox"
  mkdir -p "$sbox/.aireceipts" "$sbox/.claude/projects/demo-project"
  echo '{"shown":true}' > "$sbox/.aireceipts/telemetry.json"
  cp "$REPO/test/fixtures/claude-code/$fixture" "$sbox/.claude/projects/demo-project/session.jsonl"
}

echo "== building sandboxes =="
make_sbox "$OUT/sbox-quickstart" "clean-multi-tool-2-models.jsonl"
make_sbox "$OUT/sbox-handoff" "loop-bash-5x.jsonl"
make_sbox "$OUT/sbox-statusline" "loop-bash-5x.jsonl"

echo "== generating statusline payload (resets_at computed relative to now) =="
node -e '
  const now = Date.now();
  const payload = {
    transcript_path: process.argv[1],
    context_window: { used_percentage: 41 },
    rate_limits: {
      five_hour: { used_percentage: 63, resets_at: Math.floor((now + 2 * 3600_000 + 13 * 60_000) / 1000) },
      seven_day: { used_percentage: 22, resets_at: Math.floor((now + 3 * 86_400_000) / 1000) },
    },
  };
  require("fs").writeFileSync(process.argv[2], JSON.stringify(payload, null, 2) + "\n");
' "$OUT/sbox-statusline/.claude/projects/demo-project/session.jsonl" "$OUT/sbox-statusline/payload.json"

echo "== recording tapes =="
cd "$OUT"
SBOX_HOME="$OUT/sbox-quickstart" SBOX_BIN="$OUT/bin" vhs quickstart.tape
SBOX_HOME="$OUT/sbox-handoff"    SBOX_BIN="$OUT/bin" vhs waste-handoff.tape
SBOX_HOME="$OUT/sbox-statusline" SBOX_BIN="$OUT/bin" vhs statusline.tape

echo "== done: quickstart.gif, waste-handoff.gif, statusline.gif in $OUT =="
