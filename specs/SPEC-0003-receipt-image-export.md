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

## Design (lead-authored, binding — implementers execute, don't invent)

**Canvas.** 640px logical width; height = computed from row count (no clipping, R2).
Outer paper margin 0 — the card IS the image. Card padding: 32px sides, 26px top/bottom.
Corner radius 0 (till receipts are square). Drop shadow: none (transparent-friendly).

**Palette (CSS-var'd in the SVG for theme swap).** Light: card `#FFFFFF`, ink `#1B1E22`,
muted `#5A6068`, rule `#D8DBD6`, accent `#3947C2`, flag `#B3372E`. Dark: card `#1E2226`,
ink `#E8E8E4`, muted `#9AA0A6`, rule `#2E3438`, accent `#8B96F8`, flag `#E0705F`.
(Both pairs clear the R2 ≥4.5 contrast assertion.)

**Perforation (geometry, never glyphs).** Scalloped edges: a row of circles r=5,
spacing 14px, fill = page-background token, centered ON the top and bottom card edges —
the classic torn-receipt scallop. No dashes.

**Type.** One family stack: `"SF Mono", "Cascadia Code", "JetBrains Mono", Menlo,
Consolas, monospace`. Sizes: masthead wordmark 15px/700/letter-spacing 3px, centered;
meta lines 11.5px muted; body rows 12.5px; TOTAL 14px/700; footnotes 10.5px muted;
footer 11px centered. Row height 22px; 10px gaps between sections.

**Rows (geometry leaders).** Label left-anchored at x=32; value right-anchored at
x=608; leader = a dotted stroke (`stroke-dasharray="0.1 7"`, round caps, muted token)
drawn between label-end+8px and value-start−8px at the row's baseline−4px. Column
overlap is impossible by construction (R1 font-safety: labels truncate with "…" at
where value-start−24px would be crossed at +10% glyph width).

**Waste lines.** Prefix badge instead of the terminal's ⚠ (emoji is font-dependent):
a 12px equilateral-triangle path, flag fill, 1.5px white "!" stroke, vertically
centered. Waste row text in ink, its value in flag.

**TOTAL.** Full-inner-width 1.5px rule (rule token) above; TOTAL row bold.

**Stamp (the signature, once per receipt).** Bottom-right, 18px above the footer:
rounded-rect (radius 4) 2px stroke in accent, rotated −4°, opacity 0.8, padding
6×12px, text 10px/700/letter-spacing 2px uppercase: `LOCAL · DETERMINISTIC`.

**Footer.** Centered, muted: `aireceipts · buy me a samosa 🥟` (text glyph acceptable;
all layout-critical marks are geometry).

**compare --svg.** Two full cards side-by-side, 24px gutter, on one canvas (1304px);
the ratio-only delta line centered below both in muted 11.5px. Nothing colored
green/red across cards (I6 — no winner styling).

**Tokens-only mode.** Identical layout; every value column shows token counts; the
price-delta/stamp unchanged; zero `$` glyphs (I2) — asserted in the matrix.

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
