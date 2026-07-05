# Fix it next time (handoff)

Goal: take the waste a session actually hit and turn it into a paste-ready
instruction for your agent — so the next run doesn't repeat it.

```sh
aireceipts --handoff "intermittently"
```

```
handoff: Can you fix the flaky login test in src/auth/login.test.ts? It's failing intermittently in CI.
Claude Code · Jun 15 2026 14:00:25 UTC · 4m 35s
claude-opus-4-8 100%
total $0.09 · 6 turns · 5 tool calls
--------------------------------------------------
COULD HAVE SAVED...........................≤ $0.08
  81% of $0.09 · arithmetic, not a prediction

⚠ Bash loop ×5......................$0.08 (3m 45s)
  → change or stop after two identical failures

covers: 6 turns · 5 tool calls · 0 compactions · 1 waste line
```

The block opens with the session's state — agent, when, how long, which models,
what it cost, how many turns and tool calls (plus a compaction count when any
fired). Then comes the savings slip: a `COULD HAVE SAVED` ceiling summing the
fired waste lines (the `≤` and the hedge line are the honesty contract — this
is arithmetic over what the detectors found, never a prediction that a
different run would have gone better), each waste line as evidence with the
same `⚠`/`≈` glyphs the receipt prints, and under each class a one-line `→`
rule your agent can follow next time. The rules are fixed strings keyed to the
waste class — extracted evidence plus a static instruction, never generated
prose. It closes with a `covers:` line stating exactly what the packet
accounts for. Paste the whole block into your next prompt so the agent knows
what to avoid — here, a Bash command it re-ran five times over nearly four
minutes.

The same slip rides the PR comment: `aireceipts pr` adds a collapsed
`handoff — could have saved ≤ $X` section after the full receipts whenever a
counted session fired a waste line (and adds nothing at all on a clean PR).

## Machine-readable form

Pass `--json` for the same packet as versioned JSON (schema in
[docs/json-schema.md](../json-schema.md)) — for hooks, CI gates, or another
agent's harness. It also carries `aggregates`: every waste class that fired in
your trailing week with its distinct-session count, including classes still
below the suggestion threshold — a near-miss is a fact, not a secret.

```sh
aireceipts --handoff "intermittently" --json
```

## When there's nothing to say

If no waste detector fired on the session, there's nothing to hand off, and it
says so plainly rather than inventing advice:

```sh
aireceipts --handoff "email format"
```

```
nothing to hand off
```

An empty handoff is a good sign, not a missing feature.

## Recurring waste → a standing rule

Some waste shows up run after run. Pass `--handoff-threshold N` and, for any waste
class that recurs across `N` or more of your recent sessions, the handoff also
suggests a `CLAUDE.md` rule to prevent it — a durable fix instead of a one-off
note. The default threshold is `3`:

```sh
aireceipts --handoff --handoff-threshold 3
```

That recurrence count is the false-positive control: it requires the same
waste class to repeat across `N` *distinct recent sessions*, not just several
times inside one session, before it's ever suggested as a standing rule — a
one-off fluke, however dramatic, never becomes a `CLAUDE.md` line. And when
nothing recurs, the handoff stays silent about rules the same way it stays
silent about waste: no waste fired means `nothing to hand off`, never
invented advice.

## Next

- **[Compare two sessions](05-compare.md)** — confirm the fix actually cost less.
- **[Aggregate the week](06-week.md)** — watch `Top waste` shrink over time.
