---
id: SPEC-0020
title: "Receipt templates — user-selectable receipt styles (--template)"
status: draft
milestone: M3
depends: [SPEC-0003]
---

# SPEC-0020 · Receipt templates

Invariants: I1/I5 (deterministic per `(input, template)` — every template carries its
own byte-goldens), I2/I3/I6 unchanged in every template (honesty is not a style).

## Purpose

Different receipts serve different moments: the daily receipt wants density, the
social-share wants the grocery-store joke (Receiptify's viral engine), a screenshot in
a cost report wants a bar chart. One layout can't be all of them. v1 ships **four
maintainer-designed templates** behind `--template <name>`; a "receipts designer"
(user-composed templates) is explicitly deferred until the preset set proves demand.
**Kill criterion:** goldens ×4 templates must not slow receipt-touching PRs by >2×
golden churn — if it does, cut to `classic` + `grocery` (the two with distinct jobs).

## Architecture (binding)

A template is a **pure function at the view layer**: `buildReceiptView(model,
template)` returns the same `ReceiptView` shape with different rows/sections. The
terminal and SVG renderers stay untouched and template-agnostic — structural parity
(R4 of SPEC-0003) is preserved by construction. No template may re-derive a number;
they select and arrange what the model already computed.

## Design (lead-authored, binding — implementers execute, don't invent)

Element sources: the Receipt Design Element Inventory (vault, 2026-07). ASCII only
(anti-pattern A5): permitted glyphs `[ ] # - = . : * |`.

**`classic`** — the current design, unchanged, remains the default.

**`grocery`** — the shareable meme (Receiptify mechanics: incommensurate columns are
the joke). Masthead + `TXN #<sessionId-prefix-8>`; column header
`ITEM                          QTY        AMT`; tool rows: name / call-count / cost;
ALL-CAPS section labels bracketed by `---`; `CARDHOLDER: <dominant-model>`;
`THANK YOU FOR VIBING WITH <agent>` footer; final line a pipe-barcode
(`| || ||| | |||| ||`) derived deterministically from the sessionId (8 groups, widths
= id bytes mod 4 + 1). Waste lines render as `RETURN/REFUND` section — same numbers,
grocery framing.

**`minimal`** — Monzo discipline (discard, don't add). Max 9 lines: wordmark; title;
one meta line (agent · duration); hero TOTAL (the row, value flush right); the single
largest cost row; the first waste line if any; the same-tokens compare row; footer.
Nothing else — no methodology, no price rows (`--methodology` still exists).

**`datavis`** — Susie Lu's heirs (bars yes, bubbles no). Rows grouped into two
ALL-CAPS categories (`--- MODEL OUTPUT ---`, `--- TOOL CALLS ---`), each ordered by
cost desc; every row gains a right column normalized bar `[######----]` (10 cells,
full bar = the most expensive row, axis legend printed once above:
`bar = share of priciest line`). Totals + compare rows as in classic.

## Requirements

- **R1 — `--template <name>`** on receipt and `--svg` (both mediums, same view);
  unknown name → error listing valid names, exit 1. Default `classic` (goldens for
  existing receipts must remain byte-identical — the no-regression proof).
- **R2 — `aireceipts templates`** lists the four with a 6-line preview each (rendered
  from a built-in fixture model, not prose descriptions).
- **R3 — Honesty invariants hold per template.** Tokens-only mode, `≈` labels, waste
  semantics, and the arithmetic-not-prediction note appear (or are cut whole — never
  reworded) per the Design section; a grep battery asserts zero `$` bytes in unpriced
  renders across ALL templates.
- **R4 — Goldens per template.** The priced fixture renders byte-golden in all four
  templates × terminal + SVG light (10 new goldens); determinism ×10 covers them.
- **R5 — Config default.** `~/.aireceipts/config.json` `{"template": "grocery"}` sets
  the default; flag beats config; malformed config → stderr note + classic (mirrors
  SPEC-0009's degradation pattern).

## Scenarios

- **Given** `--template grocery` on a priced session, **then** TXN#, QTY/AMT columns,
  CARDHOLDER, and the pipe-barcode render; numbers equal classic's to the cent.
- **Given** `--template minimal` on a session with no waste, **then** ≤8 lines.
- **Given** an unpriced session in every template, **then** zero `$` bytes (R3).
- **Given** no flag and no config, **then** output is byte-identical to pre-spec
  goldens.

## Non-goals

User-composed/custom templates and any "receipts designer" (future spec, explicitly
deferred); per-template color schemes (SVG themes stay orthogonal); template-specific
new data derivations.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 default regression | existing goldens, no flag | byte-identical |
| R1 unknown name | --template foo | exit 1, lists names |
| R2 listing | templates cmd | 4 previews from fixture render |
| R3 unpriced battery | unpriced fixture × 4 templates | zero `$` bytes each |
| R3 numbers equal | priced fixture, classic vs grocery totals | identical to the cent |
| R4 goldens | 4 templates × term + SVG | byte-stable, determinism ×10 |
| R5 config | config template=grocery, no flag | grocery; flag overrides; malformed → classic + stderr |
| barcode determinism | same sessionId twice | identical pipe pattern |

## Success criteria

- [ ] A `grocery` receipt of a real session posted in the PR (the shareability test —
      does it make you want to screenshot it?).
- [ ] Unmasked gate + spec-lint green; classic goldens untouched.

## Validation

*(pending /validate-spec)*
