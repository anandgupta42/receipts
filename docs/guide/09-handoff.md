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
- Bash loop ×5: $0.08, 3m 45s wall-clock

covers: 6 turns · 5 tool calls · 0 compactions · 1 waste line
```

The block opens with the session's state — agent, when, how long, which models,
what it cost, how many turns and tool calls (plus a compaction count when any
fired) — then lists the waste lines with what each one cost, and closes with a
`covers:` line stating exactly what the packet accounts for. Everything is
extracted from the transcript, never summarized, so nothing can be paraphrased
away. Paste it into your next prompt (or your `CLAUDE.md`) so the agent knows
what to avoid — here, a Bash command it re-ran five times over nearly four
minutes.

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

## Next

- **[Compare two sessions](05-compare.md)** — confirm the fix actually cost less.
- **[Aggregate the week](06-week.md)** — watch `Top waste` shrink over time.
