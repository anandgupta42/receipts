---
id: SPEC-0003
title: "Receipt SVG export — the shareable artifact"
status: approved
milestone: M2
depends: [SPEC-0001]
---

# SPEC-0003 · Receipt SVG export

Invariants: I1 (deterministic), I2/I3 (same honesty rules as the terminal — the image
is the terminal receipt, restyled), I5 (SVG bytes are golden-gated), I6.
Roadmap note: image export moves M3→M2 (SPEC-0000 roadmap amended in the same change —
compare/handoff shipped inside M1, freeing M2).

## Purpose

The screenshot IS the distribution: model-comparison blog posts, "look what my agent
spent" posts, PR attachments. Ship a till-receipt SVG people want to share. PNG
rasterization is deliberately deferred to its own spec (a native renderer dependency
deserves its own decision — S2 finding).

## Requirements

- **R1 — `--svg`.** Render the receipt (identical data/fields as the terminal render,
  nothing more) to a self-contained SVG (`-o` names the file). Zero new runtime deps.
  **Determinism scope stated honestly:** SVG *bytes* are deterministic and golden-gated;
  on-screen rendering uses the viewer's monospace font. To keep layout font-safe:
  perforation, leader dots, rules, and the stamp are geometry (SVG shapes, never font
  glyphs); text layout is computed from character counts on a fixed column grid with
  padding tolerant of ±10% glyph-width variance. Fixed 640px logical width; `--theme
  light|dark` (default light).
- **R2 — Design assertions (objective, not taste).** Tests assert: perforation path
  elements present top+bottom; every leader row's label and value x-extents do not
  overlap; stamp element rotated within [-6°,-2°]; theme contrast — text fill vs
  background luminance ratio ≥ 4.5 in both themes; total height grows linearly with
  line count (no clipping).
- **R3 — `compare --svg`.** Two receipts side-by-side in one SVG with the delta line
  (I6: no better/worse language).
- **R4 — No leakage / parity.** The SVG renders exactly the terminal receipt's fields:
  both renderers consume one shared `ReceiptModel` structure; a test diffs their field
  sets against it.

## Non-goals

PNG/raster output (own spec: renderer dependency decision); auto-posting/upload; GIF;
custom themes beyond light/dark; embedded font files (revisit if glyph-width variance
breaks layout in practice); watermarks.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 svg golden | priced fixture, both themes | byte-identical SVG goldens ×2 runs |
| R1 tokens-only svg | unpriced fixture | zero `$` glyphs in SVG text nodes |
| R1 font-safety | longest fixture labels | column-grid extents non-overlapping at +10% glyph width |
| R2 geometry | both themes | perforation/leader/stamp assertions + contrast ≥ 4.5 |
| R3 compare svg | two fixtures | one SVG, two columns, delta line present |
| R4 parity | terminal vs svg field sets | identical field list vs shared ReceiptModel |

## Success criteria

- [ ] An SVG receipt from a real session attached to the PR (maintainer visual check).
- [ ] Goldens + unmasked gate + spec-lint green.
- [ ] `compare --svg` output from two synthetic fixtures attached to the PR.

## Validation

**2026-07-02 · S1:** determinism claim re-scoped to bytes + font-safe geometry rules.
**S2 (Codex):** verdict REWORK → reworked same day. Accepted: milestone/roadmap mismatch
fixed by amending the SPEC-0000 roadmap (flagged in the approval request); PNG cut to
its own spec (optionalDependency judged weak for npx); subjective "shareable" checks
replaced with objective geometry/contrast/no-overlap assertions (R2); font-stack
determinism restated honestly with geometry-not-glyphs rules. **S3:** the levelsio
screenshot-virality evidence + compare-artifact demand from the cost-wave research.
**S4:** spec-lint green.
