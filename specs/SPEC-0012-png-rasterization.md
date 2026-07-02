---
id: SPEC-0012
title: "PNG rasterization"
status: draft
milestone: M4
depends: [SPEC-0003]
---

# SPEC-0012 · PNG rasterization

Invariants: I1 (no native compilation required on the user's machine), I5 (SVG input
stays byte-deterministic; PNG pixel output is not claimed to be).

## Purpose

Resolves the renderer-dependency decision SPEC-0003 deliberately deferred ("PNG/raster
output (own spec: renderer dependency decision)", SPEC-0003 Non-goals): evaluate
`@resvg/resvg-js` (or equivalent) as a real dependency — install size/time measured in
the test matrix — versus docs-only `--svg` + an external convert step. Ship `--png`
only if the measured cost clears a stated threshold. **Kill criterion:** the R1 spike
numbers, whichever way they land — a passed threshold ships `--png`; a failed one ships
docs-only. Both are valid closes for this spec.

## Requirements

- **R1 — Feasibility spike (blocking).** Add the candidate rasterizer as a
  devDependency; measure (a) `npm pack`/install size delta, (b) cold-install time
  delta, (c) whether prebuilt binaries cover macOS/Linux/Windows without native
  compilation. Record the numbers in the PR description before deciding R2.
- **R2 — Threshold gate (numeric, set now).** Ship `--png` only if: unpacked
  install-size delta ≤ 12 MB AND cold `npm install` time delta ≤ 2.5 s (CI runner) AND
  prebuilt binaries cover macOS/Linux/Windows with no C toolchain. The spike runs
  dev-only; promotion to a runtime dependency happens only on a passed gate, recorded
  as a decision note in the PR. Failing any bound ships docs-only guidance (`--svg` +
  a documented external convert command) — an equally valid close.
- **R3 — Same renderer, rasterized (if R2 passes).** `--png` rasterizes the same shared
  `ReceiptModel` SPEC-0003 R4 already uses for terminal/SVG parity — never a third
  independent renderer. Same `-o` file-naming convention as `--svg` (SPEC-0003 R1).
  Fixed pixel dimensions derived deterministically from the SVG's fixed 640px logical
  width at a stated DPI constant.
- **R4 — Determinism scope.** PNG *pixel* determinism across platforms is not claimed
  (rasterizer/font-hinting differences are real) — only the input SVG stays byte-
  deterministic (SPEC-0003 R1) and the rasterizer version is pinned. Stated explicitly
  in the PNG doc note.
- **R5 — Single-receipt only.** `compare --png` is explicitly deferred until
  single-receipt PNG has shipped and survived a release (S2: doubles the blast radius
  of a new native dependency) — listed in Non-goals.

## Scenarios

- **Given** the R1 spike exceeds the maintainer's stated cap, **when** this spec ships,
  **then** `--png` is not implemented; docs-only guidance lands instead.
- **Given** the gate passes, **when** `--png` runs on a priced fixture, **then** a PNG
  writes at the expected fixed dimensions.
- **Given** `--png` on two CI platforms, **when** compared, **then** the input SVG bytes
  are identical (golden) even though PNG bytes may differ — documented, not silently
  assumed equal.
- **Given** `compare --png`, **when** rendered, **then** the two-column layout matches
  `compare --svg`'s structure.

## Non-goals

Any rasterizer requiring native compilation on the user's machine; PNG byte-for-byte
determinism across platforms (R4); GIF/animated formats; a from-scratch PNG encoder.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 spike measured | candidate rasterizer added | size/time/binary-coverage numbers recorded in PR |
| R2 gate fails | cost over cap or native compile required | --png dropped, docs-only guidance ships |
| R2 gate passes | cost under cap, prebuilt binaries | --png implemented |
| R3 parity | priced fixture | PNG = rasterized ReceiptModel, correct fixed dimensions |
| R4 determinism note | cross-platform PNG bytes | SVG input identical (golden); PNG bytes not claimed equal |
| R5 deferral | compare --png invoked | actionable "use compare --svg" message, exit 1 |

## Success criteria

- [ ] PR documents R1's measured numbers regardless of outcome — the docs-only branch
      is an acceptable, complete close.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`).

## Validation

**2026-07-02 · S2 (Codex): PASS-WITH-FIXES → applied.** Numeric gate bounds baked in
(≤12 MB unpacked, ≤2.5 s cold-install, prebuilt-binaries-only); dev-only spike with
explicit runtime-promotion decision step; `compare --png` deferred out of v1. **S4:** green.
