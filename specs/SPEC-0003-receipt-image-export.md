---
id: SPEC-0003
title: "Receipt image export — the shareable artifact (--svg / --png)"
status: draft
milestone: M2
depends: [SPEC-0001]
---

# SPEC-0003 · Receipt image export

Invariants in play: I1 (deterministic), I2/I3 (same honesty rules as the terminal —
the image is the terminal receipt, restyled), I5 (SVG bytes are golden-gated).

## Purpose

The screenshot IS the distribution: model-comparison blog posts, "look what my agent
spent" posts, PR attachments. Ship a till-receipt image — perforated edges, dotted
leaders, monospace, ink stamp — that people want to share.

## Requirements

- **R1 — `--svg`.** Render the receipt (identical data/fields as the terminal render,
  nothing more) to a self-contained SVG written next to stdout target (`-o` to name).
  Hand-built SVG (zero new runtime deps), system font-stack text, fixed 640px logical
  width, light + dark via `--theme light|dark` (default light). Deterministic bytes —
  golden-tested like the terminal receipt.
- **R2 — `--png`.** Rasterize R1's SVG at 2× via `@resvg/resvg-js` declared as an
  **optionalDependency**, lazy-imported; if unavailable, exit 1 with "PNG needs the
  optional renderer — use --svg, or npm i @resvg/resvg-js". PNG is dimension-tested,
  not byte-golden (rasterizer versions vary).
- **R3 — Design language.** The receipt aesthetic: dashed perforation top/bottom,
  dotted leader lines, centered masthead, rotated ink-stamp total badge, samosa footer.
  One decisive look, no configuration beyond theme.
- **R4 — `compare --svg`.** Two receipts side-by-side in one image with the delta line —
  the model-comparison artifact (I6: no better/worse language).
- **R5 — No leakage.** The image renders exactly the terminal receipt's fields; a test
  diffs the field set of both renderers against one shared source-of-truth structure.

## Non-goals

Auto-posting/upload anywhere; GIF/terminal recording; custom themes/branding;
watermarks; raster golden bytes.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 svg golden | priced fixture, both themes | byte-identical SVG goldens ×2 runs |
| R1 tokens-only svg | unpriced fixture | zero `$` glyphs in SVG text nodes |
| R2 png present | renderer installed | PNG exists, 1280px wide, nonzero size |
| R2 png absent | renderer missing (mocked) | exit 1 + actionable message |
| R3 design elements | svg golden inspection | perforation, leaders, stamp, footer nodes present |
| R4 compare svg | two fixtures | one SVG, two columns, delta line present |
| R5 parity | terminal vs svg field sets | identical field list (shared structure test) |

## Success criteria

- [ ] An SVG receipt from a real session posted in the PR (visual check by maintainer).
- [ ] Goldens + unmasked gate green; spec-lint green.
- [ ] `compare --svg` output attached to the PR (two synthetic fixtures).

## Validation

*(pending /validate-spec)*
