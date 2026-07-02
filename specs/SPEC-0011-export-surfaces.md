---
id: SPEC-0011
title: "Export surfaces — CSV, versioned JSON schema, OTEL spans"
status: draft
milestone: M4
depends: [SPEC-0001, SPEC-0008]
---

# SPEC-0011 · Export surfaces — CSV, versioned JSON schema, OTEL spans

Invariants: I2 (empty, never fabricated, cells/attributes for missing $ data), I5
(schema is a byte-stable, versioned contract), I6 (no ranking fields).

## Purpose

Formalizes SPEC-0001 R6's existing `--json` flag into a documented, semver'd schema
(`schemaVersion: 1`), adds `--csv` (per-session and per-tool rows) for FinOps/
spreadsheet ingestion, and adds `aireceipts export otel --endpoint <url>` — OTLP spans
carrying per-tool cost/token attributes for teams that already run an observability
pipeline. All three are one-shot, opt-in exporters over the same computed receipt; none
run automatically. **Kill criterion:** if no external tool, spreadsheet, or OTEL
collector ever consumes an export within two releases of shipping, the surfaces are
frozen (no v2) rather than expanded further.

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
- **R6 — `export otel`.** A registered exporter (single-source-of-truth discipline: one
  `Exporter` interface, one registry array, `--format`/id-based selection — mirrors this
  repo's own EXPORTERS registry pattern) converts the already-computed receipt into OTLP
  spans over HTTP to `--endpoint`: one root span per session, one child span per tool
  call, each carrying cost and token attributes (the cost attribute is omitted, never
  `0`, when unpriced). Emit-only — `aireceipts` never runs or bundles a collector; an
  unreachable endpoint fails loudly with a clear error, never a silent drop.

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
- **Given** an unpriced fixture, **when** `export otel --endpoint <url>` runs, **then**
  the emitted spans carry token attributes with no cost attribute present.
- **Given** an unreachable `--endpoint`, **when** `export otel` runs, **then** it fails
  loudly with a non-zero exit, never a silent no-op.

## Non-goals

XML or other export formats; a hosted ingestion endpoint (local file output only for
CSV/JSON, I1); schema v2 design; backward-incompatible changes to the existing `--json`
shape beyond adding the version field; bundling or running an OTEL collector (`export
otel` emits only — bring your own collector).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 schema validity | priced fixture, --json | validates against v1, schemaVersion: 1 present |
| R2 csv unpriced | unpriced fixture, --csv | $ cells empty, token cells populated |
| R2 csv modes | --csv=session vs --csv=tool | correct row granularity, RFC 4180 quoting |
| R3 compare export | compare --csv / --json | 2 rows + delta, no ranking field |
| R4 semver guard | bumped schemaVersion, stale docs | parity test fails build |
| R5 week parity | week --json | same schemaVersion as session --json |
| R6 otel spans | priced + unpriced fixture, export otel | spans emitted; cost attr omitted when unpriced |
| R6 unreachable endpoint | export otel, bad --endpoint | loud failure, non-zero exit, no silent drop |

## Success criteria

- [ ] `docs/json-schema.md` published; a real CSV+JSON pair and a real OTEL span
      capture from a live session attached to the PR (dogfood).
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`).
