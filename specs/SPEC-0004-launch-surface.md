---
id: SPEC-0004
title: "Launch surface — README, docs, demo assets, maintainer voice"
status: draft
milestone: M2
depends: [SPEC-0001, SPEC-0002, SPEC-0003]
---

# SPEC-0004 · Launch surface

Invariants: I3 (docs never overclaim), I4 (telemetry disclosed exactly as implemented).
Voice rule (binding): indie maintainer voice — "I", "maintainer"; never "founder",
company, or agent-process framing in public-bound text.

## Purpose

Make the repo read like a launchable indie project the morning it goes public: a
stranger lands on the README and runs `npx aireceipts` within 60 seconds.

## Requirements

- **R1 — README rewrite.** Hero: one dark-theme SVG receipt (from SPEC-0003, synthetic
  fixture) + the one-liner + `npx aireceipts`. Then: what it reads (agents supported
  matrix incl. Cursor's degraded mode, stated honestly), what it will never do (predict
  another model would have succeeded — the honesty ladder in one sentence), the
  telemetry sentence linking docs/telemetry.md, quickstart for `compare` and
  `--handoff`, samosa link placeholder, MIT. ≤120 lines.
- **R2 — docs/telemetry.md.** Field-by-field schema exactly mirroring SPEC-0002's zod
  schemas (the parity test from SPEC-0002 binds this file), kill switches, the open
  embedded-key note, first-run notice text reproduced.
- **R3 — CONTRIBUTING.md.** Short: this repo is spec-driven and largely agent-built;
  how to file issues (agent:fix / agent:feat labels), the gates a PR must pass, AGENTS.md
  is the operating manual. ≤60 lines.
- **R4 — Demo assets.** `docs/assets/`: 2 SVG receipts (single + compare) generated from
  synthetic fixtures via SPEC-0003, committed and embedded in the README.
- **R5 — Maintainer-voice sweep.** Replace "founder" with "maintainer" across AGENTS.md,
  skills, SPEC-0000 (concept unchanged); grep gate: zero matches for
  founder|Altimate|internal in README/docs/CONTRIBUTING.

## Non-goals

Show HN post copy (separate, human-timed); making the repo public; npm publish;
website/domain content; GIF recordings.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 quickstart truth | README commands run verbatim | each exits 0 on a fixture |
| R2 parity | docs/telemetry.md vs zod schemas | field lists identical (SPEC-0002 test) |
| R3 contributing exists | CONTRIBUTING.md | present, ≤60 lines, gates listed |
| R4 assets render | committed SVGs | valid SVG, referenced by README, <150KB each |
| R5 voice grep | repo public-bound text | zero founder/Altimate/internal matches |

## Success criteria

- [ ] A cold reader (critic agent prompted as one) reads README only and successfully
      runs the tool on a fixture — friction notes filed as issues.
- [ ] Unmasked gate + spec-lint green; voice grep green.

## Validation

*(pending /validate-spec)*
