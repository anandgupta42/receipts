---
id: SPEC-0010
title: "Adapter breadth — Cursor full adapter, Gemini CLI, opencode"
status: approved
milestone: M3
depends: [SPEC-0001]
---

# SPEC-0010 · Adapter breadth — Cursor full adapter, Gemini CLI, opencode

Invariants: I1 (local files only, no vendor API calls), I2 (degrade to tokens-only when
usage isn't exposed), I5 (goldens per adapter).

## Purpose

Un-degrade Cursor from M1's totals-only mode, then extend the `SessionAdapter` seam
(`src/parse/types.ts`'s `roots`/`detect`/`listSessions`/`loadSession` interface) to two
more vendors — **if** each store actually exposes per-turn usage. Priority order,
evidence-driven: (1) Cursor — a forum report (#157311) says
`~/.cursor/projects/*/agent-transcripts/*.jsonl` carries per-message and per-tool-call
detail, which may supersede the degraded `unpriceable: true` path documented at
`src/parse/cursor.ts:8-20`; success here means un-degrading M1's Cursor mode; (2) Gemini
CLI (`~/.gemini/tmp/<project>/chats/`); (3) opencode
(`~/.local/share/opencode/storage/session/...`). Aider and Copilot are named as
follow-ups only, out of scope here. R1 is a blocking feasibility spike per vendor, not a
promise. **Kill criterion:** if none of the three clears R1, this spec ships zero
new/upgraded adapters and documents why — a valid, honest close.

## Requirements

- **R1 — Feasibility spike (blocking, per vendor, versioned evidence).** Confirm the
  vendor's actual on-disk format on a real install, recording the vendor app version.
  For Cursor: the `agent-transcripts/*.jsonl` claim rests on ONE forum post while
  shipped code marks Cursor `unpriceable` (`src/parse/cursor.ts:15`) — any "fully
  priced" acceptance requires evidence from ≥2 real fixtures (different sessions)
  showing per-turn model ids AND per-turn token usage, captured with the Cursor version
  noted. A vendor with no stable local per-turn transcript is dropped from this spec.
- **R2 — One adapter per PR.** Each lands independently (mirrors SPEC-0005 R2); a
  Cursor upgrade replaces its `unpriceable: true` path in place rather than adding a
  second adapter entry. Registered in `ADAPTERS` (`src/parse/registry.ts:6`); new
  vendors add their id to the `AgentSource` union (`src/parse/types.ts:13`).
- **R3 — Full-fidelity adapter (if R1 finds per-turn usage).** Implements
  `SessionAdapter` fully: per-turn model id, the COMPLETE `TokenUsage` contract
  (input/output/cacheRead/`cacheCreation` — buckets a vendor doesn't expose are zeroed,
  with the zeroing rule documented per field), and tool calls with enough timing to
  feed SPEC-0001 R4a. **Vendor resolution is part of this requirement:** a session's
  per-turn model ids must map to their true price-vendor tables (e.g. an anthropic
  model inside a Cursor session prices from `anthropic.json`) via an explicit
  model-id→vendor rule extending `vendorForSource` — today it returns `undefined` for
  anything beyond the three `AgentSource` values. If the mapping is ambiguous for a
  turn, that turn is unpriced (I2) — never a guessed vendor. Corrupt/partial files
  degrade per SPEC-0001 R1.
- **R4 — Degraded fallback (if only totals are exposed).** Same `unpriceable: true`
  pattern already shipped for Cursor: `--list` + tokens-only receipt, explicit note,
  never priced attribution. Applies to Gemini CLI/opencode if R1 finds totals-only.
- **R5 — Fixtures + goldens.** ≥2 sanitized real fixtures per landed/upgraded adapter,
  golden receipts for each.

## Scenarios

- **Given** Cursor's `agent-transcripts/*.jsonl` carries per-turn usage, **when**
  `aireceipts` runs against a Cursor fixture, **then** a fully priced receipt renders
  (replacing the old tokens-only path).
- **Given** Cursor's per-turn claim doesn't hold up under R1, **when** the spike
  finishes, **then** Cursor stays on its existing degraded path, documented as such.
- **Given** Gemini CLI's store exposes per-turn usage, **when** `aireceipts` runs
  against a Gemini CLI fixture, **then** a fully priced receipt renders.
- **Given** opencode's store exposes totals only, **when** `aireceipts` runs, **then**
  `--list` shows it and the receipt renders tokens-only with the degraded note.
- **Given** none of the three clears R1, **when** this spec ships, **then** zero
  adapters land/upgrade and the PR states the spike findings.
- **Given** a corrupt file from a landed adapter, **when** `aireceipts` runs, **then**
  it's skipped with a stderr note, exit 0.

## Non-goals

Aider, Copilot, or any vendor not named here (deferred as follow-ups); back-filling
historical format versions (current format only; old files degrade per the
corrupt-file rule); network calls to any vendor API (I1).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 spike documented | real install of each vendor | path + shape recorded in PR, or vendor dropped |
| R1 Cursor upgrade check | Cursor agent-transcripts fixture | confirmed per-turn usage or fallback stays |
| R2 registry wiring | landed/upgraded adapter | appears in ADAPTERS (+ AgentSource union if new) |
| R1 versioned evidence | 2 Cursor fixtures + version note | per-turn model+usage present in both, or fallback stays |
| R3 full parse | per-turn-usage fixture | priced receipt, correct per-tool split |
| R3 vendor mapping | anthropic-model turn in Cursor session | priced from anthropic.json; ambiguous id → unpriced |
| R3 usage zeroing | vendor w/o cache buckets | cacheRead/cacheCreation zeroed per documented rule |
| R3 corrupt file | truncated transcript | skipped w/ stderr note, exit 0 |
| R4 degraded parse | totals-only fixture | `--list` shows it; tokens-only receipt + note |
| R5 goldens | ≥2 fixtures per landed/upgraded adapter | golden receipts committed |

## Success criteria

- [ ] A real receipt from at least one landed/upgraded adapter attached to the PR — or,
      if none land, the R1 spike findings documented instead (dogfood or honest
      non-result).
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`).

## Validation

**2026-07-02 · S2 (Codex): PASS-WITH-FIXES → applied.** Cursor "fully priced" claims
now require versioned evidence from ≥2 real fixtures (one forum post isn't
load-bearing); vendor-resolution made explicit (model-id→price-vendor mapping extending
`vendorForSource`; ambiguous → unpriced per I2); full `TokenUsage` contract incl.
`cacheCreation` with per-field zeroing rules. **S4:** spec-lint green.
