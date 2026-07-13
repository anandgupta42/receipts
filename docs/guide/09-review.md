# Review a completed session

Goal: find concrete problems in a saved coding session and get a practical way to
prevent each one next time.

```sh
aireceipts review
```

Pass a [session selector](04-read-a-receipt.md#pick-a-different-session) to review
something other than the newest session:

```sh
aireceipts review "flaky login test"
```

The review is deterministic and local. It reads recorded actions and statuses; it
does not ask a model to judge the work or invent advice.

## How to read it

A finding looks like this:

```text
THINGS TO IMPROVE

The same failed action was tried again unchanged
  What happened: The same recorded action failed at least twice within the next ten actions. No file change or passing check was recorded between those failures.
  Evidence: recorded attempts: 2 · retries after the first error: 1 · recorded turns: 4, 6 · tools: Bash
  Why it matters: Trying the same failed action again without recorded progress is a useful point to change approach.
  Prevent it next time: After the same action fails twice without recorded progress, inspect the error and change the input or approach, or record the blocker before trying again.
  What this does not prove: Some failures may be deliberate tests; this does not prove the retry was unreasonable.
```

Every finding uses the same plain-language blocks:

- **What happened** says exactly which recorded pattern matched.
- **Evidence** gives bounded counts, turn numbers, and sanitized tool names. It never
  prints commands, file paths, prompts, or responses.
- **Why it matters** explains the practical risk without guessing intent.
- **Prevent it next time** gives one fixed recommendation from the pattern registry.
- **What this does not prove** names the most important reasonable alternative.

Findings are grouped by how they should be interpreted:

- **Things to improve** have the strongest recorded evidence for a preventable process
  problem, such as retrying the same failed action unchanged.
- **Cost opportunities** compare listed prices for the same recorded tokens. They are
  arithmetic only, not a claim that another model would complete the task.
- **Things to watch** are exact recorded patterns with more possible explanations, such
  as several deliberate error probes or rereading a file to regain context.

## What coverage means

The final `COVERAGE` block separates checks the trace supported from checks that could
not run because that transcript source did not record the needed evidence:

```text
COVERAGE
Checks run: 6
Checks unavailable for this trace: 0
```

An unavailable check is not treated as a pass. The review also does not run every idea
ever considered: weak or unproven ideas remain preserved but disabled in the generated
[pattern reference](../reference/review-patterns.md).

## When no supported pattern matches

The empty state is deliberately narrow:

```text
No supported issues found in the recorded evidence.
```

It means the checks that ran did not find a supported pattern. It does not mean the
session was flawless, the task was completed, or an unavailable check would have
passed.

## Recurring problems

By default, a finding is marked recurring when the same registry pattern appears in at
least three distinct sessions in its seven-day window. The repeated finding uses the
exact same prevention recommendation; it never generates a second interpretation.

Change the distinct-session threshold when you need a stricter local signal:

```sh
aireceipts review --review-threshold 5
```

The command only suggests considering the recommendation for project instructions. It
never edits a file.

## Machine-readable review

```sh
aireceipts review --json
```

JSON findings are keyed by stable pattern ID and include the rule version, fixed copy,
bounded evidence, optional role-labeled impact, recurrence, and evaluated-versus-
unavailable coverage. See the [export schema](../json-schema.md).

## Next

- **[Read a receipt](04-read-a-receipt.md)** — see where the session's recorded usage went.
- **[Compare two sessions](05-compare.md)** — compare observable cost floors after changing the process.
- **[Browse every review pattern](../reference/review-patterns.md)** — see what is shown, measured only, or disabled.
