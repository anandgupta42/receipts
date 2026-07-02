# SPEC-0010 Cursor full-adapter spike

Date: 2026-07-02

Verdict: Cursor stays degraded. Do not replace `src/parse/cursor.ts`'s
`unpriceable: true` path in this PR.

## Question

Can current Cursor local storage provide per-turn model ids and per-turn token
usage so aireceipts can price Cursor sessions without fabricating dollars?

## Evidence Checked

- Local Cursor install: `cursor --version` reported `3.7.36`, commit
  `776d1f9d76df50a4e0aeca61819a88e7c1b861e0`, `arm64`.
- Local app bundle: `/Applications/Cursor.app/Contents/Info.plist` reported
  `CFBundleShortVersionString = 3.7.36` and `CFBundleVersion = 3.7.36`.
- Local DB path checked:
  `/Users/anandgupta/Library/Application Support/Cursor/User/globalStorage/state.vscdb`.
- SQLite tables present: `ItemTable`, `cursorDiskKV`.
- Structural counts from `cursorDiskKV`:
  - `composerData:%`: 293 rows.
  - `bubbleId:%`: 4513 rows.
  - keys matching `%agent-transcripts%`: 0 rows.
- Composer structural JSON check:
  - `$.tokenCount.inputTokens`, `$.tokenCount.outputTokens`, `$.model`,
    `$.lastUsedModel`: absent across 293 composer rows.
  - `$.fullConversationHeadersOnly`: array in 113 rows.
  - `$.tokenCount`: integer in 24 rows.
- Bubble structural JSON check:
  - 3097 bubble rows have both `$.toolFormerData` and `$.tokenCount` as objects.
  - No checked bubble row exposed `$.model` or `$.usage`.
- The SPEC-0010 motivating `agent-transcripts/*.jsonl` claim was not found in
  this local Cursor install. Web searches for `agent-transcripts`, Cursor forum
  `157311`, and `~/.cursor/projects/*/agent-transcripts/*.jsonl` did not
  produce a durable source with two versioned fixture shapes showing both
  per-turn model ids and per-turn token usage.

## Interpretation

Cursor's current observed storage still fails SPEC-0010 R1's upgraded-adapter
bar. There is session/message structure and some token counts, but the evidence
does not show both of the fields needed for priced per-turn attribution:

- Per-turn model id: absent from checked composer and bubble shapes.
- Per-turn token usage: not present under a stable `usage` shape; token counts
  appear in aggregate/message-ish positions without a versioned model id.

The spec requires versioned evidence from at least two real Cursor fixture
shapes before "fully priced" Cursor acceptance. This spike has one local
versioned negative shape and no corroborating documented positive source, so
the honest close is degraded mode.

## Decision

No Cursor parser change. Keep the existing `state.vscdb` / `cursorDiskKV`
adapter as tokens-only and `unpriceable: true` per I2.
