# Use a template

Goal: render the same receipt in a different visual style — for a screenshot, a
share, or just taste.

A template changes only how the receipt is *drawn*. The observable lower-bound
numbers, honesty rules, and totals are identical across all of them.

## See the styles

```sh
aireceipts templates
```

prints a short live preview of each built-in template:

```
── classic  (default) ──
Bash............................≥ $0.05  (3 calls)
Edit............................≥ $0.05  (2 calls)
(thinking/reply)................≥ $0.03  (2 turns)
Write...........................≥ $0.03  (2 calls)
Read.............................≥ $0.02  (1 call)
--------------------------------------------------

── grocery ──
TXN #A2998369
ITEM                              QTY          AMT
Bash                                3      ≥ $0.05
Edit                                2      ≥ $0.05
(thinking/reply)                    2      ≥ $0.03
Write                               2      ≥ $0.03

── datavis ──
[##########] = priciest line; others in proportion

--- MODEL OUTPUT ---
(thinking/reply)..............≥ $0.03 [######----]

--- TOOL CALLS ---
```

(The preview uses small synthetic numbers; your own receipts show your session's
actual floors.)

## Apply one

Pass `--template <name>` (`classic`, `grocery`, or `datavis`) with any selector:

```sh
aireceipts --template grocery "email format"
```

```
- - - - - - - - - - - - - - - - - - - - - - - - -
                    AIRECEIPTS                    
 “Add email format validation to the signup for…” 
 Claude Code · Jun 18 2026 09:30:30 UTC · 10m 30s 
    claude-opus-4-8 87% · claude-sonnet-5 13%     
         cache served 85% of input tokens         

TXN #E336964E
ITEM                              QTY          AMT
Bash                                3    ≥ $0.0517
Edit                                2    ≥ $0.0455
(thinking/reply)                    2    ≥ $0.0310
Write                               2    ≥ $0.0290
Read                                1    ≥ $0.0192
--------------------------------------------------
TOTAL                                    ≥ $0.1764
standard API-equivalent floor; not an invoice
same tokens on claude-haiku-4-5..........≥ $0.0392
  (78% lower observable floor)
  (arithmetic, not a prediction)

CARDHOLDER: claude-opus-4-8
- - - - - - - - - - - - - - - - - - - - - - - - -
      THANK YOU FOR VIBING WITH Claude Code       
           || |||| |||| ||| || ||| | ||
- - - - - - - - - - - - - - - - - - - - - - - - -
```

The `TXN #` and barcode are a deterministic hash of the session — the same session
always renders the same code. `datavis` instead draws each line as a proportional
bar:

```sh
aireceipts --template datavis "email format"
```

```
[##########] = priciest line; others in proportion

--- MODEL OUTPUT ---
(thinking/reply)............≥ $0.0310 [######----]

--- TOOL CALLS ---
Bash........................≥ $0.0517 [##########]
Edit........................≥ $0.0455 [#########-]
Write.......................≥ $0.0290 [######----]
Read........................≥ $0.0192 [####------]
```

`--template` works with the image exports too — see
[Share and export](11-share-and-export.md).

## Adding a template

Templates are built in, not user config files. A new style ships as a small
contribution to the renderer — see `CONTRIBUTING.md` and the existing templates
under `src/receipt/`. Open a PR with a template and its golden output, and it
becomes available to everyone.

## Next

- **[Share and export](11-share-and-export.md)** — save any template as an SVG or PNG.
- **[Read a receipt](04-read-a-receipt.md)** — the default `classic` layout in detail.
