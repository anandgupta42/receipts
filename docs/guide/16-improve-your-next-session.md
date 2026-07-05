# Improve your next session

Goal: turn today's receipt into a cheaper session tomorrow — a six-step loop,
in order, using commands you already have.

## 1. Read the waste lines

Every receipt lists what it caught, each priced on its own line. A `$0.08`
stuck loop and a `$12` one deserve different amounts of attention — read the
receipt (see [Read a receipt](04-read-a-receipt.md)) before you do anything
else.

## 2. Hand it off

```sh
aireceipts --handoff
```

Paste the block into your next prompt, or into `CLAUDE.md` if you want it to
stick across sessions. See [Fix it next time](09-handoff.md) for a full
worked example, and the `--json` form for hooks or another agent's harness.

## 3. Let recurring waste graduate into a rule

A single session's waste is a note. Waste that recurs across sessions is a
pattern worth a standing rule — but only once it's actually recurred:
`--handoff-threshold` (default `3`) requires a waste class to show up in `3`
or more of your recent sessions before the handoff suggests a `CLAUDE.md`
line for it. That gate is deliberate — a one-off fluke never becomes a
standing rule — and near-misses below the threshold still show up in the
`--json` form's `aggregates`, so you can watch one build toward it.

## 4. Set a budget

A budget won't stop an agent mid-run, but it will tell you the moment you're
near or over one, and give a script an exit code to key off:

```sh
aireceipts --check-budget || echo "over budget this week"
```

Full setup: [Set and watch a budget](08-budget.md).

## 5. Verify the fix actually cost less

Once you've applied a handoff — or just changed how you prompt — compare the
session before the fix to the one after:

```sh
aireceipts compare <before> <after>
```

Each argument is a selector (index, session id, or title substring); the
closing line states the ratio between the two, in dollars. Guide:
[Compare two sessions](05-compare.md).

## 6. Watch the week trend down

```sh
aireceipts week
```

prints a trailing-7-day digest, including `Top waste` — the number to watch
shrink as fixes stick, and the one this whole loop is aimed at. See
[Aggregate the week](06-week.md).

## Next

- **[Fix it next time](09-handoff.md)** — the handoff block in full, with the
  false-positive gate explained.
- **[Set and watch a budget](08-budget.md)** — the advisory cap this loop
  feeds.
