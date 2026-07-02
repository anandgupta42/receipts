---
name: add-vendor-adapter
description: "Add support for a new AI coding-agent transcript format to aireceipts (e.g. a new agent besides Claude Code / Codex). Use when the user asks to support a new agent/vendor, add a transcript adapter, or parse a new log format."
trigger: /add-vendor-adapter
---

# /add-vendor-adapter — support a new transcript format

## 1. Spec first

If no approved spec covers this vendor, run `/write-spec` first. The spec must name the
real, on-disk transcript format (with at least one real sample file path or a cited
schema doc) — never a guessed format.

## 2. Where it lives

- New file: `src/parse/<vendor>.ts`. Owns detecting and parsing that vendor's transcript
  into the shared internal session shape used by `src/receipt/` and `src/pricing/`.
- Register it in the adapter registry (the single dispatch point other adapters use —
  find it via the existing adapters; don't create a second registry).
- The adapter never talks to the network and never calls a model (I1).

## 3. Fixtures — real, not synthesized

Collect **at least 3 real transcript fixtures** from the vendor (redact secrets/PII, but
keep the structure and tool-call shapes real). Synthetic fixtures hide format quirks
real transcripts have; they don't satisfy this bar.

## 4. Goldens

For each fixture, generate the receipt and commit it as a golden
(`test/fixtures/<vendor>/*.golden`). The golden is the contract (I5) — regenerate it
deliberately when the renderer changes, never silently.

## 5. Edge cases to cover explicitly

- A session with zero cost-attributable tool calls (should not fabricate a `$`, I2).
- A session that mixes models mid-session, if the vendor's format allows it.
- Truncated/partial transcript (agent still running, or log cut off).
- A model/date combination with no matching price-table row — must fall back to tokens,
  never a guessed price (I2).

## 6. Gate + land

Run the unmasked verification block (`AGENTS.md`). Add the adapter to
`AGENTS.md`'s current-state inventory note only via the `release` skill, not here.
Then `/build-spec` the PR as usual.
