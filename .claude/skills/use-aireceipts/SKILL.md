---
name: use-aireceipts
description: "Teaches an agent how to drive the aireceipts CLI against real sessions — the dogfood skill. Use when asked to generate a receipt for a session, attach a cost receipt to a PR, or demonstrate/dogfood aireceipts on real transcripts."
trigger: /use-aireceipts
---

# /use-aireceipts — dogfood the CLI on a real session

## 1. Build

`npm run build` (tsup → `dist/cli.js`). Don't run against `src/` directly — the shipped
CLI is what users get, so dogfood the built artifact.

## 2. Find the transcript

Point the CLI at the real transcript for the session you want a receipt for — the
current Claude Code session's own log under `~/.claude/projects/**`, or a Codex session
log, matching whatever adapters exist. Don't fabricate a transcript to demo against.

## 3. Generate the receipt

```sh
node dist/cli.js receipt <path-to-transcript>
```

Read the output: per-tool breakdown, any waste lines, the counterfactual (if a
comparison model was requested), and the handoff block.

## 4. Sanity-check it against I2/I6 before showing anyone

- Does every `$` figure trace to a matched price-table row (I2)? If the receipt shows
  tokens instead of a dollar figure for part of the session, that's correct behavior for
  an unmatched model/date — not a bug to "fix" by guessing a price.
- Does the copy avoid ranking language (I6) — no "model X is better than Y," just what
  this session cost?

## 5. Attach to a PR (optional)

If the PR being reviewed was built by an agent, paste the handoff block into the PR
description — this is the dogfood loop: every agent-authored PR can carry its own
session's receipt as provenance.

If the receipt looks wrong (an FP waste line, a fabricated-looking number, a confusing
counterfactual), that's a real bug — file it via `/fix-issue`, don't quietly ignore it.
