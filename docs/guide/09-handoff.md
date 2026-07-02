# Fix it next time (handoff)

Goal: take the waste a session actually hit and turn it into a paste-ready
instruction for your agent — so the next run doesn't repeat it.

```sh
aireceipts --handoff "intermittently"
```

```
handoff: Can you fix the flaky login test in src/auth/login.test.ts? It's failing intermittently in CI.
- Bash loop ×5: $0.08, 3m 45s wall-clock
```

The block names the session and lists the waste lines that fired, with what each
one cost. Paste it into your next prompt (or your `CLAUDE.md`) so the agent knows
what to avoid — here, a Bash command it re-ran five times over nearly four minutes.

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
