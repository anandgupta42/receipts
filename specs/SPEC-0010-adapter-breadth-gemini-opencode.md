---
id: SPEC-0010
title: "Adapter breadth — Gemini CLI + opencode"
status: draft
milestone: M3
depends: [SPEC-0001]
---

# SPEC-0010 · Adapter breadth — Gemini CLI + opencode

Invariants: I1 (local files only, no vendor API calls), I2 (degrade to tokens-only when
usage isn't exposed, per the Cursor precedent), I5 (goldens per adapter).

## Purpose

Two new adapters through the existing `SessionAdapter` seam (`src/parse/types.ts`'s
`roots`/`detect`/`listSessions`/`loadSession` interface) — **if** each vendor's on-disk
transcript actually exposes per-turn usage. R1 is a blocking feasibility spike, not a
promise: a vendor whose local format gives only totals ships Cursor-style degraded
(`unpriceable: true`); a vendor with no local transcript at all is dropped from this
spec entirely. **Kill criterion:** if neither vendor clears R1, this spec ships zero new
adapters and documents why — that is a valid, honest close.

## Requirements

- **R1 — Feasibility spike (blocking).** Locate each vendor's actual on-disk session
  storage location and record shape on a real install; document the exact path
  convention + shape in the PR description before writing any parser (mirrors the
  Cursor adapter's documented DB-key convention, `src/parse/cursor.ts:8-19`). A vendor
  with no stable local transcript is dropped from this spec.
- **R2 — One adapter per PR.** Each lands independently (mirrors SPEC-0005 R2),
  registered in `ADAPTERS` (`src/parse/registry.ts:6`) with its id added to the
  `AgentSource` union (`src/parse/types.ts:13`).
- **R3 — Full-fidelity adapter (if R1 finds per-turn usage).** Implements
  `SessionAdapter` fully: per-turn model id, `TokenUsage` (input/output/cacheRead), and
  tool calls with enough timing to feed SPEC-0001 R4a's loop detector. Corrupt/partial
  files degrade per SPEC-0001 R1 (skip + stderr note, never crash).
- **R4 — Degraded adapter (if only totals are exposed).** Same `unpriceable: true`
  pattern as Cursor (`src/parse/cursor.ts:20`): `--list` + tokens-only receipt only,
  with an explicit note, never priced attribution.
- **R5 — Fixtures + goldens.** ≥2 sanitized real fixtures per landed adapter, golden
  receipts for each.

## Scenarios

- **Given** Gemini CLI's store exposes per-turn usage, **when** `aireceipts` runs
  against a Gemini CLI fixture, **then** a fully priced receipt renders.
- **Given** opencode's store exposes totals only, **when** `aireceipts` runs, **then**
  `--list` shows it and the receipt renders tokens-only with the degraded note.
- **Given** neither vendor clears R1, **when** this spec ships, **then** zero adapters
  land and the PR states the spike findings.
- **Given** a corrupt file from a landed adapter, **when** `aireceipts` runs, **then**
  it's skipped with a stderr note, exit 0.

## Non-goals

Any adapter not named here (OpenClaw etc. already deferred, SPEC-0001 Non-goals);
back-filling historical format versions (parse the current format only; old files
degrade per the corrupt-file rule); network calls to any vendor API (I1).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 spike documented | real install of each vendor | path + shape recorded in PR, or vendor dropped |
| R2 registry wiring | landed adapter | appears in ADAPTERS + AgentSource union |
| R3 full parse | per-turn-usage fixture | priced receipt, correct per-tool split |
| R3 corrupt file | truncated transcript | skipped w/ stderr note, exit 0 |
| R4 degraded parse | totals-only fixture | `--list` shows it; tokens-only receipt + note |
| R5 goldens | ≥2 fixtures per landed adapter | golden receipts committed |

## Success criteria

- [ ] A real receipt from at least one landed adapter attached to the PR — or, if zero
      land, the R1 spike findings documented instead (dogfood or honest non-result).
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`).
