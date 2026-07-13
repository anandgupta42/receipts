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
budget (this week): ≥ $0.00 of $20.00 — advisory only — does not stop the agent (coverage: 0 full, 0 partial, 0 excluded; top-level only; child/subagent transcripts excluded)
```

(The demo sessions here are from an earlier week, so this window's observable
floor is `≥ $0.00`. The configured `$20.00` cap is exact; computed spend is not.)
The cap is rendered at the same precision used by the comparison: for example,
`20.005` displays as `$20.005`, and `0.004` displays as `$0.004`.

## Check it in a script

```sh
aireceipts --check-budget
```

prints the same advisory line(s) and sets an **exit code**: `1` when an observable
lower-bound sum exceeds any configured cap, and `0` otherwise. A zero exit does
not prove the eventual invoice is under the cap; unobserved components can only
make the real amount higher. "Exceeded" is a strict `>` — a floor exactly at the
cap is not yet over it. That makes it composable:

```sh
aireceipts --check-budget || echo "over budget this week"
```

The daily window is the current UTC calendar day; the weekly window is the rolling
`[now − 7 days, now)`. USD coverage is split into `full`, `partial`, and
`excluded`. The line prints the exact known unpriced-token subtotal when a
partial or excluded session has one. A summary whose full load is null or
degraded stays in the window denominator and is labeled unreadable; its unknown
dollars are never guessed into the sum. A session with a cached component but no
cited applicable cache rate is also `partial`; the line calls out that cache-rate
gap without fabricating a token quantity the trace did not record.

Budget windows are top-level-only and explicitly exclude child/subagent
transcripts. This is a current limitation, not a claim that child activity was
free; use a single-session or PR receipt for child rollups.

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
