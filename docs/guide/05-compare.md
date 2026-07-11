# Compare two sessions

Goal: put two receipts next to each other and see the ratio between them —
which run cost more, and by how much.

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

Bash..............................$0.05  (3 calls)
Edit..............................$0.05  (2 calls)
(thinking/reply)..................$0.03  (2 turns)
Write.............................$0.03  (2 calls)
Read...............................$0.02  (1 call)
--------------------------------------------------
TOTAL........................................$0.18
same tokens on claude-haiku-4-5..............$0.04
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

Bash..............................$0.08  (5 calls)
(thinking/reply)...................$0.02  (1 turn)

⚠ Bash loop ×5......................$0.08 (3m 45s)
--------------------------------------------------
TOTAL........................................$0.09
same tokens on claude-haiku-4-5..............$0.02
  (arithmetic, not a prediction)
- - - - - - - - - - - - - - - - - - - - - - - - -
                npx aireceipts-cli                
         github.com/anandgupta42/receipts
- - - - - - - - - - - - - - - - - - - - - - - - -

Add email format validation to the signup form and add a unit test for it. The signup form is in src/components/SignupF… cost 1.9× Can you fix the flaky login test in src/auth/login.test.ts? It's failing intermittently in CI. ($0.18 vs $0.09)
```

The closing line is the whole point: the first session cost **1.9×** the second
(`$0.18` vs `$0.09`). Note the second receipt also surfaces a `⚠ Bash loop ×5`
waste line — comparison is often how a cheaper-looking run turns out to have burned
its budget in a loop.

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
- **[Fix it next time](09-handoff.md)** — turn a waste line into a rule for your agent.
