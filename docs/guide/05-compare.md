# Compare two sessions

Goal: put two receipts next to each other and compare their observable
Standard-API floors without claiming either vendor invoice.

```sh
aireceipts compare "email format" "intermittently"
```

Each argument is a [selector](04-read-a-receipt.md#pick-a-different-session) — an
index, a session id, or a title substring. aireceipts prints both receipts, then
a one-line ratio:

```
=== Add email format validation to the signup form and add a unit test for it. The signup form is in src/components/SignupF… ===
- - - - - - - - - - - - - - - - - - - - - - - - -
                    AIRECEIPTS                    
 “Add email format validation to the signup for…” 
 Claude Code · Jun 18 2026 09:30:30 UTC · 10m 30s 
    claude-opus-4-8 87% · claude-sonnet-5 13%     
         cache served 85% of input tokens         

Bash..........................≥ $0.0517  (3 calls)
Edit..........................≥ $0.0455  (2 calls)
(thinking/reply)..............≥ $0.0310  (2 turns)
Write.........................≥ $0.0290  (2 calls)
Read...........................≥ $0.0192  (1 call)
--------------------------------------------------
TOTAL....................................≥ $0.1764
standard API-equivalent floor; not an invoice
same tokens on claude-haiku-4-5..........≥ $0.0392
  (78% lower observable floor)
  (arithmetic, not a prediction)
- - - - - - - - - - - - - - - - - - - - - - - - -
                npx aireceipts-cli                
         github.com/anandgupta42/receipts
- - - - - - - - - - - - - - - - - - - - - - - - -

=== Can you fix the flaky login test in src/auth/login.test.ts? It's failing intermittently in CI. ===
- - - - - - - - - - - - - - - - - - - - - - - - -
                    AIRECEIPTS                    
 “Can you fix the flaky login test in src/auth/…” 
 Claude Code · Jun 15 2026 14:00:25 UTC · 4m 35s  
               claude-opus-4-8 100%               
         cache served 88% of input tokens         

Bash..........................≥ $0.0767  (5 calls)
(thinking/reply)...............≥ $0.0178  (1 turn)

⚠ Bash loop ×5..................≥ $0.0767 (3m 45s)
--------------------------------------------------
TOTAL....................................≥ $0.0945
standard API-equivalent floor; not an invoice
same tokens on claude-haiku-4-5..........≥ $0.0189
  (arithmetic, not a prediction)
- - - - - - - - - - - - - - - - - - - - - - - - -
                npx aireceipts-cli                
         github.com/anandgupta42/receipts
- - - - - - - - - - - - - - - - - - - - - - - - -

Add email format validation…'s standard-API floor is 1.9× Can you fix the flaky login test…'s (≥ $0.1767 vs ≥ $0.0945)
```

The closing line is the whole point: the first observable floor is **1.9×** the second
(`≥ $0.1767` vs `≥ $0.0945`). Compare works on the raw session floors, which can sit
a fraction of a cent above each ledger's displayed `TOTAL` (the ledger is derived
from its displayed rows so they always sum exactly; both are true floors of the same
session). This is a ratio of cited floor arithmetic, not a ratio
of invoices, and aireceipts emits it only when both parent-plus-subagent ledgers
have full pricing coverage. If either side is partial, the closing line says the
sessions are not directly comparable and lists each side's known `≥ $` subtotal
plus exact known-unpriced tokens; it never gives an unsupported directional
ratio. Note the second receipt also surfaces a `⚠ Bash loop ×5`
flagged-pattern line — comparison shows where the detector found a repeated loop;
it does not prove that the subtotal was avoidable savings.

On a wide terminal the two receipts render side by side; on a narrow one they
stack, as above. Either way the numbers are identical.

## Save it as an image

To share the comparison, render it as an SVG:

```sh
aireceipts compare "email format" "intermittently" --svg -o compare.svg
```

See [Share and export](11-share-and-export.md) for themes and formats.

## Next

- **[Aggregate the week](06-week.md)** — compare against a whole week, not one session.
- **[Review a completed session](09-review.md)** — find recorded problems and prevent them next time.
