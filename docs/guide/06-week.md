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
Priced floor (5 full + 0 partial).......≥ $0.22
Pricing coverage.......5 full · 0 partial · 0 none
Tokens (observable)..................166,338 tok
Scope............top-level only; children excluded

By agent
  Claude Code.....................≥ $0.19 · 2 sess
  Codex...........................≥ $0.03 · 3 sess

Flagged patterns
  stuck-loop...................≈ $0.01 · 1 session
  trivial-spans.............≈ $0.0040 · 2 sessions
  heuristic pattern cost · standard API floor · not proven savings

vs. prior 7 days (Jun 11 2026 → Jun 18 2026)
  Priced floor Δ...................≈ +$0.12 (more)
  Tokens Δ......................+93,700 tok (more)
  Excluded.........................0 now / 0 prior
--------------------------------------------------
                npx aireceipts-cli                
         github.com/anandgupta42/receipts
```

`Priced floor (5 full + 0 partial)` distinguishes complete observed pricing from
sessions where only some request components had a trustworthy model/date/price
join. `Pricing coverage` reports loaded sessions as `full`, `partial`, or `none`;
an additional `Unreadable` row appears when an in-window summary cannot be fully
loaded. Those unreadable summaries remain in the `Sessions` denominator instead
of disappearing. When a whole request envelope is outside the dollar floor, an exact
`Known unpriced tokens` subtotal appears. `Tokens (observable)` includes every
trusted token subtotal, whether priced or not — a coverage gap cannot masquerade
as a complete spend number. A `Cache-rate gaps` row means a priced session had a
cached component with no cited applicable rate; that session is `partial`, never
`full`. The exact unpriced-token subtotal is not padded with an invented cache
quantity when the trace does not expose one.

The digest is deliberately top-level-only. Child/subagent transcripts are not
rolled into `week`; the human output says so, and JSON carries
`scope.childSessionsIncluded: false`. Use the single-session or PR receipt when
you need the child-rollup path.

The deltas at the bottom are reported **per category, never blended**: the dollar
delta only appears when both weeks have comparable priced coverage; it is
labeled approximate because subtracting two floors is not itself a bound. The token delta always
appears, and `Excluded` counts unpriced sessions in each window separately. Each
delta carries a plain-language direction — `(more)`, `(less)`/`(fewer)`, or
`(flat)` — read against the `vs. prior 7 days` header, so a negative figure like
`-93,700 tok (fewer)` reads unambiguously as *fewer tokens this week*, not more.

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
  form............................≥ $0.18 · 1 sess
  (unknown).......................≥ $0.03 · 3 sess
  qa..............................≥ $0.01 · 1 sess
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
- **[Review a completed session](09-review.md)** — inspect one session and get prevention advice.
