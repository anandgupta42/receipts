# Get started in 60 seconds

aireceipts reads the transcripts your AI coding agent already writes to disk and
prints a priced receipt of what a session cost. No account, no API key; your
transcripts and code are never uploaded (anonymous diagnostics are opt-out — see
[docs/telemetry.md](../telemetry.md)).

This page takes you from nothing to a receipt, a weekly total, and an automatic
receipt after every session — in about a minute.

## 1. Run it

You don't install anything first. One command reads your newest session and
prices it:

```sh
npx aireceipts-cli
```

The first time it runs, it prints a one-line note about anonymous diagnostics
(and how to turn them off — see [Troubleshooting](12-troubleshooting.md)), then
the receipt. You'll see something like this:

```
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

Per-turn cost split evenly across that turn's tool
calls; unpriced models show tokens only, never
guessed dollars. Full method: aireceipts
--methodology
- - - - - - - - - - - - - - - - - - - - - - - - -
       aireceipts · local · buy me a samosa       
- - - - - - - - - - - - - - - - - - - - - - - - -
```

That's a real session: which models ran, where the tokens went by tool, and what
it cost — priced against dated, cited price tables. The `same tokens on
claude-haiku-4-5` line re-prices the identical token counts on a cheaper model;
it's arithmetic, not a claim that Haiku would have finished the job.

If instead you see `no agent session data detected`, your agent's logs are
somewhere aireceipts doesn't look yet — jump to [Troubleshooting](12-troubleshooting.md).

No sessions of your own yet? See one now:

```sh
npx aireceipts-cli --demo
```

It renders a bundled example session through the same pipeline your real
sessions use — a genuine receipt, not a mockup — so you can see the output
before your first run.

## 2. Add up the week

One session is a number. The trailing week is a habit:

```sh
npx aireceipts-cli week
```

```
                  WEEKLY DIGEST                   
    Jun 18 2026 → Jun 25 2026 · since override    

Sessions.........................................5
Priced total (5 of 5)........................$0.22
Tokens (all sessions)..................166,338 tok

By agent
  Claude Code.......................$0.19 · 2 sess
  Codex.............................$0.03 · 3 sess

Top waste
  stuck-loop.....................$0.01 · 1 session
  trivial-spans.................$0.00 · 2 sessions

vs. prior 7 days (Jun 11 2026 → Jun 18 2026)
  Priced $ Δ................................+$0.12
  Tokens Δ.............................+93,700 tok
  Excluded.........................0 now / 0 prior
--------------------------------------------------
       aireceipts · local · buy me a samosa       
```

Every session on your machine, across every supported agent, totalled for the
last seven days — still local, still no upload.

## 3. Make it automatic

You won't remember to run a command after every session. Let Claude Code run it
for you:

```sh
npx aireceipts-cli install-hook
```

It shows you the exact change, asks before writing, and installs a `SessionEnd`
hook. From then on a six-line mini-receipt prints when a Claude Code session ends.
Full walkthrough: [Install the agent hook](03-install-hook.md).

## Next

- **[Install](02-install.md)** — run it without `npx` on every invocation.
- **[Read a receipt](04-read-a-receipt.md)** — pick any session, not just the newest.
- **[Set a budget](08-budget.md)** — get an exit code when the week crosses a cap.
- **[FAQ](../faq.md)** — how this differs from usage dashboards, what the dollars
  mean on a subscription, what leaves your machine (nothing but disclosed,
  content-free telemetry), and more.
