# Fix it next time (handoff)

Goal: take the patterns a session's heuristic detectors flagged and turn them
into paste-ready instructions for your agent. The evidence can guide the next
run; it does not prove that the flagged work was avoidable.

```sh
aireceipts --handoff "intermittently"
```

```
handoff: Can you fix the flaky login test in src/auth/login.test.ts? It's failing intermittently in CI.
Claude Code · Jun 15 2026 14:00:25 UTC · 4m 35s
claude-opus-4-8 100%
total ≥ $0.09 · 6 turns · 5 tool calls
--------------------------------------------------
FLAGGED PATTERN COST.......................≈ $0.07
  heuristic pattern subtotal · not proven savings

⚠ Bash loop ×5....................≥ $0.07 (3m 45s)
  at turns 1-5
  → change or stop after two identical failures

covers: 6 turns · 5 tool calls · 0 compactions · 1 waste line
```

![Historical terminal recording of a synthetic handoff. It predates the current flagged-pattern-cost and lower-bound notation.](../../site/assets/waste-handoff.gif)

The block opens with the session's state — agent, when, how long, which models,
its observable Standard-API floor, how many turns and tool calls (plus a
compaction count when any fired). Then comes `FLAGGED PATTERN COST ≈ $X`: the
largest priced subtotal among the stuck-loop and context-thrash detector
classes. The approximation is intentional. A detector identifies a pattern to
inspect; it does not prove the pattern was avoidable, so this subtotal is not a
savings floor, savings ceiling, or percentage of total. It never adds classes
that may overlap, and it excludes trivial-span dollars because those are
counterfactual re-pricing rather than observed cost. Each waste line is evidence with the
same `⚠`/`≈` glyphs the receipt prints, and under each class a one-line `→`
rule your agent can follow next time. The rules are fixed strings keyed to the
waste class — extracted evidence plus a static instruction, never generated
prose. It closes with a `covers:` line stating exactly what the packet
accounts for. Paste the whole block into your next prompt so the agent knows
what to avoid — here, a Bash command it re-ran five times over nearly four
minutes.

The same slip rides the PR comment: `aireceipts pr` adds a collapsed
`handoff — flagged pattern cost ≈ $X` section after the full receipts whenever a
counted session fired a waste line (and adds nothing at all on a clean PR).

## Machine-readable form

Pass `--json` for the same packet as versioned JSON (schema in
[docs/json-schema.md](../json-schema.md)) — for hooks, CI gates, or another
agent's harness. It also carries `aggregates`: every waste class that fired in
your trailing week with its distinct-session count, including classes still
below the suggestion threshold — a near-miss is a fact, not a secret.
The historical `couldHaveSaved` JSON field remains present for schema
compatibility. Its `usd` is the same overlap-safe flagged-pattern subtotal, not
proven savings, and `pctOfTotal` is always `null`: a ratio of lower bounds has
no reliable direction.

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

## Next

- **[Compare two sessions](05-compare.md)** — compare the observable floors after the fix.
- **[Aggregate the week](06-week.md)** — track flagged-pattern counts and heuristic subtotals over time.
