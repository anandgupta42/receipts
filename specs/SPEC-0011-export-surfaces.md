---
id: SPEC-0011
title: "Export surfaces — CSV + versioned JSON schema"
status: draft
milestone: M4
depends: [SPEC-0001, SPEC-0002, SPEC-0003, SPEC-0008]
---

# SPEC-0011 · Export surfaces — CSV + versioned JSON schema

Invariants: I2 (empty, never fabricated, cells/attributes for missing $ data), I5
(schema is a byte-stable, versioned contract), I6 (no ranking fields).

## Purpose

Formalizes SPEC-0001 R6's existing `--json` flag into a documented, semver'd schema
(`schemaVersion: 1`) and adds `--csv` (per-session and per-tool rows) for FinOps/
spreadsheet ingestion. Both are one-shot, opt-in exporters over the same computed
receipt (the shared `ReceiptModel` from SPEC-0003; zod arrives as a dependency via
SPEC-0002). OTLP/OTEL export was cut to its own future spec by S2 review — see
Non-goals.
**Kill criterion:** if no external tool, spreadsheet, or OTEL collector ever consumes an
export within two releases of shipping, the surfaces are frozen (no v2), not expanded.

## Requirements

- **R1 — JSON schema v1.** A zod schema in `src/receipt/**` is the single source of
  truth for `--json`'s shape; `docs/json-schema.md` mirrors it field-by-field, parity-
  tested (same pattern as SPEC-0002 R2/`docs/telemetry.md`). Root object carries
  `schemaVersion: 1`.
- **R2 — `--csv`.** `--csv=session` (default) emits one summary row per session;
  `--csv=tool` emits one row per tool line. Header row always present; RFC 4180 quoting
  for text; `$` cells are an empty string (never `0`/`null`) when unpriced; token cells
  are always populated (I2).
- **R3 — `compare --csv` / `compare --json`.** Two rows/objects (one per session) plus a
  delta field — never a "better/worse" ranking field (I6).
- **R4 — Semver discipline.** Any breaking schema change bumps `schemaVersion`; the
  parity test (R1) asserts the version constant matches `docs/json-schema.md`. CSV
  columns are additive-only within a major version.
- **R5 — `week` reuse.** SPEC-0008's existing `week --json` is brought under the same
  `schemaVersion`, rather than a second undocumented shape (single-source-of-truth
  rule).
- **R6 — Exporter seam.** CSV and JSON land behind one `Exporter` interface + registry
  (id-based selection) so future exporters (OTLP among them) plug in without touching
  the render path — the seam ships now, the network-touching exporter does not.

## Scenarios

- **Given** a priced fixture, **when** `--json` runs, **then** output validates against
  the documented v1 schema with `schemaVersion: 1` present.
- **Given** an unpriced fixture, **when** `--csv` runs, **then** `$` cells are empty
  strings, token cells populated.
- **Given** `compare --csv`, **when** parsed, **then** exactly two data rows plus a
  delta field, no ranking text.
- **Given** a schema change without a matching `docs/json-schema.md` update, **when**
  the parity test runs, **then** it fails the build.
- **Given** `week --json`, **when** validated, **then** it carries the same
  `schemaVersion` field as the single-session `--json`.
- **Given** a second exporter registered in a test, **when** selected by id, **then**
  it receives the same `ReceiptModel` the CSV/JSON exporters consume (seam proof).

## Non-goals

XML or other export formats; a hosted ingestion endpoint (local file output only,
I1); schema v2 design; backward-incompatible `--json` changes beyond the version field;
**OTLP/OTEL export — cut by S2 review**: an `--endpoint` send is a product network call
requiring its own opt-in consent flow, an explicit I4 exception, and a precise
emit-only OTLP/HTTP JSON definition (span/trace-id determinism, resource attrs,
collector interop) — a dedicated future spec owns all of that on top of this spec's
exporter seam.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 schema validity | priced fixture, --json | validates against v1, schemaVersion: 1 present |
| R2 csv unpriced | unpriced fixture, --csv | $ cells empty, token cells populated |
| R2 csv modes | --csv=session vs --csv=tool | correct row granularity, RFC 4180 quoting |
| R3 compare export | compare --csv / --json | 2 rows + delta, no ranking field |
| R4 semver guard | bumped schemaVersion, stale docs | parity test fails build |
| R5 week parity | week --json | same schemaVersion as session --json |
| R6 seam | test-registered second exporter | receives the shared ReceiptModel by id selection |

## Success criteria

- [ ] `docs/json-schema.md` published; a real CSV+JSON pair from a live session
      attached to the PR (dogfood).
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`).

## Validation

**2026-07-02 · S2 (Codex): REWORK → reworked.** Accepted: OTEL cut to its own future
spec — an endpoint send is a product network call needing SPEC-0015-style consent, an
I4 exception, and a precise OTLP/HTTP JSON emit definition none of which belong in a
CSV spec; the exporter SEAM ships here instead so that spec plugs in cleanly. Real
dependencies added (SPEC-0002 for zod, SPEC-0003 for the shared ReceiptModel — the
cited `src/receipt/**` did not yet exist when drafted). **S4:** spec-lint green.
