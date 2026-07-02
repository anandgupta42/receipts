---
id: SPEC-0020
title: "Receipt templates — user-selectable receipt styles (--template)"
status: approved
milestone: M3
depends: [SPEC-0003]
---

# SPEC-0020 · Receipt templates

Invariants: I1/I5 (deterministic per `(input, template)` — every template carries its
own byte-goldens), I2/I3/I6 unchanged in every template (honesty is not a style).

## Purpose

Different receipts serve different moments: the daily receipt wants density, the
social-share wants the grocery-store joke (Receiptify's viral engine), a screenshot in
a cost report wants a bar chart. One layout can't be all of them. v1 ships **three
maintainer-designed templates** behind `--template <name>` (`minimal` was cut in
validation: it duplicated the existing `--mini` surface and could not carry the I3
methodology text inside its line budget); a "receipts designer" is explicitly deferred.
**Kill criterion (measurable):** total golden artifacts stay ≤ 26 and
`verify-goldens.mjs` wall time stays ≤ 2× the pre-spec baseline recorded in the PR —
exceed either and `datavis` is cut first.

## Architecture (binding — corrected in validation)

The current `ReceiptView` is flat and both renderers hardcode its sequence, so this
spec includes a **one-time view refactor**: `ReceiptView` becomes an ordered
`blocks: Block[]` list (`masthead | meta | columnHeader | row | wasteRow | rule |
total | note | footnote | barcode | footer`), and BOTH renderers become block
interpreters (each block type has one terminal and one SVG layout). After that,
a template is a pure function `buildReceiptView(model, template)` emitting a block
list — adding a template touches no renderer. **Blocks are plain serializable data**
(a JSON-safe discriminated union, no functions/closures): this is what lets the future
user-template file (~/.aireceipts/templates/<name>.json, exported via a future
`templates export`, validated by validateReceiptBlocks at load) be a declarative
document rather than code. Classic's block list must reproduce
today's output byte-identically (the refactor's no-regression proof). **Per-template
parity test:** terminal and SVG are asserted to consume the identical block list per
template (structure parity, not just model-field parity). No template re-derives a
number. **Forward-compatibility (binding):** the R3 honesty battery is implemented
as a pure function over a block list (`validateReceiptBlocks(blocks, model) →
violations[]`), used by the tests today and reusable unchanged as a load-time
validator when user-supplied templates arrive (a future `--template-file` that fails
validation refuses to render — honesty blocks are non-removable by construction).

## Design (lead-authored, binding — implementers execute, don't invent)

Element sources: the Receipt Design Element Inventory (vault, 2026-07). ASCII only
(anti-pattern A5): permitted glyphs `[ ] # - = . : * |`.

**`classic`** — the current design, unchanged, remains the default.

**`grocery`** — the shareable meme (Receiptify mechanics: incommensurate columns are
the joke). Masthead + `TXN #<sessionId-prefix-8>`; column header
`ITEM                           QTY        AMT` — exact 50-char column math: ITEM
left-aligned cols 1–28 (truncate with `…` at 27), QTY right-aligned cols 30–37, AMT
right-aligned cols 39–50; every emitted line is asserted ≤50 chars in tests;
ALL-CAPS section labels bracketed by `---`; `CARDHOLDER: <dominant-model>`;
`THANK YOU FOR VIBING WITH <agent>` footer; final line a pipe-barcode
(`| || ||| | |||| ||`) derived deterministically from the sessionId (8 groups, widths
= id bytes mod 4 + 1). Waste lines render as `RETURN/REFUND` section — same numbers,
grocery framing.

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
- **R3 — Honesty invariants hold per template (exact-wording battery).** Priced
  renders in EVERY template must contain the exact `METHODOLOGY_BRIEF` string and the
  exact price-delta note wording (byte-equal substrings, no paraphrase); unpriced
  renders contain zero `$` bytes; waste `≈` labels are byte-equal to the constants.
  A section may be absent only where this spec's Design section says so explicitly.
- **R4 — Goldens per template.** The priced fixture renders byte-golden in all four
  templates × terminal + SVG light (10 new goldens); determinism ×10 covers them.
- **R5 — Goldens matrix (exact).** New goldens: {grocery, datavis} × {terminal, SVG
  light} on the priced fixture = 4 new artifacts (classic's existing goldens are the
  refactor regression gate; SVG dark stays classic-only). Determinism ×10 covers all.

## Scenarios

- **Given** `--template grocery` on a priced session, **then** TXN#, QTY/AMT columns,
  CARDHOLDER, and the pipe-barcode render; numbers equal classic's to the cent.
- **Given** an unpriced session in every template, **then** zero `$` bytes (R3).
- **Given** no flag and no config, **then** output is byte-identical to pre-spec
  goldens.

## Non-goals

User-composed/custom templates and any "receipts designer" — deferred on an explicit
ladder: v1.x community templates arrive as code PRs passing this spec's battery +
goldens; a `--template-file`/designer only after that, gated on the
validateReceiptBlocks load-time validator (see Architecture); per-template color schemes (SVG themes stay orthogonal); template-specific
new data derivations; a config-file default template (`~/.aireceipts/config.json`
needs its own shared-config spec — SPEC-0009's budget.json rejects extra keys, and
two ad-hoc config files is how config stories rot; flag-only in v1).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 default regression | existing goldens, no flag | byte-identical |
| R1 unknown name | --template foo | exit 1, lists names |
| R2 listing | templates cmd | 4 previews from fixture render |
| R3 unpriced battery | unpriced fixture × 4 templates | zero `$` bytes each |
| R3 numbers equal | priced fixture, classic vs grocery totals | identical to the cent |
| R4 goldens | 4 templates × term + SVG | byte-stable, determinism ×10 |
| R5 goldens | grocery+datavis × term+svg-light | 4 artifacts byte-stable ×10 |
| grocery width | every grocery line, long tool names | ≤50 chars, `…` truncation |
| block parity | per template | terminal + SVG consume identical block lists |
| barcode determinism | same sessionId twice | identical pipe pattern |

## Success criteria

- [ ] A `grocery` receipt of a real session posted in the PR (the shareability test —
      does it make you want to screenshot it?).
- [ ] Unmasked gate + spec-lint green; classic goldens untouched.

## Validation

**2026-07-02 · S2 (Codex): REWORK → reworked same day, all 7 applied.** Blockers: the
"renderers untouched" architecture claim was FALSE (flat ReceiptView; both renderers
hardcode the sequence) → replaced with an explicit block-AST refactor + per-template
block parity tests; `minimal` violated I3 (numbers without methodology) and duplicated
`--mini` → CUT (3 templates). Also: exact grocery column math + ≤50-char assertions;
R3 upgraded to an exact-wording battery; config-file default cut to non-goals (no
second ad-hoc config file); goldens matrix made exact with a measurable kill
criterion. **S4:** spec-lint green.
