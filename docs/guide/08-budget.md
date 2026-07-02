# Set and watch a budget

Goal: define a spend cap and get a plain signal — a line, and an exit code — when
you're near or over it.

> **Advisory only.** A budget in aireceipts **does not stop your agent.** Nothing
> here intercepts a session, pauses a tool call, or blocks work. It reads
> transcripts your agent already wrote and reports a number after the fact. The
> disclaimer is printed on every budget line so it can never be mistaken for a
> hard cap.

## Configure it

Create `~/.aireceipts/budget.json` with a `daily` and/or `weekly` cap. Each period
is exactly one of `usd` or `tokens`, a positive number:

```json
{
  "daily": { "usd": 5 },
  "weekly": { "usd": 20 }
}
```

Rules the file must satisfy: at least one of `daily`/`weekly`; each period has
exactly one of `usd`/`tokens`; the value is a positive, finite number. Anything
else is reported and ignored (see below) rather than silently accepted.

## See it on the receipt

With a budget configured, the full receipt appends one advisory line per period:

```
budget (this week): $0.00 of $20.00 — advisory only — does not stop the agent
```

(The demo sessions here are from an earlier week, so this window's spend is
`$0.00`; on your machine it's your real spend for the current window.)

## Check it in a script

```sh
aireceipts --check-budget
```

prints the same advisory line(s) and sets an **exit code**: `0` when you're under
every configured cap, `1` when any cap is exceeded. "Exceeded" is a strict
`>` — a sum exactly at the cap is not yet over it. That makes it composable:

```sh
aireceipts --check-budget || echo "over budget this week"
```

The daily window is the current UTC calendar day; the weekly window is the rolling
`[now − 7 days, now)`. Sessions on unpriced models are excluded from a `usd` sum
(and the line says how many), never guessed into it.

## When the file is wrong

A malformed budget file never crashes the command — it's reported on stderr and
ignored:

```
budget.json ignored: unknown key(s): monthly
```

(There is no `monthly` period — only `daily` and `weekly`.)

## Next

- **[Aggregate the week](06-week.md)** — the spend the weekly cap is measured against.
- **[Fix it next time](09-handoff.md)** — reduce the number instead of just watching it.
