# Aggregate the week

Goal: total every session from the last seven days, across every agent, with an
honest comparison to the week before.

```sh
aireceipts week --since 2026-06-18
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
                aireceipts · local                
```

`Priced total (5 of 5)` reads "5 of 5 sessions had a price"; if some ran on
unpriced models, the dollar total covers only the priced ones while the token
total covers all of them — a coverage gap can never masquerade as a spend change.
The deltas at the bottom are reported **per category, never blended**: the dollar
delta only appears when both weeks are fully priced, the token delta always
appears, and `Excluded` counts unpriced sessions in each window separately.

## The window

By default the window is `[now − 7 days, now)` — so the digest moves with the
clock, and running it tomorrow includes a different seven days. The prior window
is always the seven days immediately before it. A session is bucketed by when it
**ended**; a session with no end time is counted in neither window rather than
guessed into one.

## Pin the window with `--since`

Pass a date to anchor the window's **start** instead of its end (`[D, D + 7 days)`),
which also makes the output reproducible:

```sh
aireceipts week --since 2026-06-18
```

That's the invocation shown at the top — the `· since override` in the header
marks it. A bare `aireceipts week` (no `--since`) instead prints a trailing-7-days
header ending at the current moment.

## Split by project

```sh
aireceipts week --by-project
```

adds a breakdown keyed by the working directory each session ran in:

```
By project
  form..............................$0.18 · 1 sess
  (unknown).........................$0.03 · 3 sess
  qa................................$0.01 · 1 sess
```

Sessions whose project can't be determined (some agents don't record it) roll up
under `(unknown)` rather than being dropped.

## Machine-readable

For dashboards and scripts, `--json` emits the same digest as structured data:

```sh
aireceipts week --since 2026-06-18 --json
```

See [Share and export](11-share-and-export.md) for the shape.

## Next

- **[Set a budget](08-budget.md)** — turn the weekly total into an exit code.
- **[Fix it next time](09-handoff.md)** — act on the `Top waste` lines.
