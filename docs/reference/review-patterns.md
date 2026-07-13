# Session review pattern reference

This page lists every idea considered for session review, including ideas that are not currently shown. It is generated from the same registry the command uses, so the wording here cannot quietly drift from the product.

Run `aireceipts review` to inspect a completed coding session. The review reports only what the saved trace can support, explains why it may matter, and gives one prevention step for next time.

## What the statuses mean

| Status | Meaning |
|---|---|
| Shown as a cost opportunity | Shown when listed prices give a lower arithmetic result for the same recorded usage. |
| Shown as an issue | Shown when the recorded evidence matches the rule. |
| Shown as something to watch | Shown with an extra caution because there may be a reasonable explanation. |
| Measured only | Evaluated during development, but not shown in command output or sent in telemetry. |
| Not run | Kept in the registry so the idea and its limitations are not lost, but it is not evaluated. |

Registry version: 1. Pattern count: 23.

## Same action repeated without a change

- Pattern key: `repeated-identical-attempt`
- Status: Shown as an issue
- Rule version: 1

What it notices: The same tool ran at least three times in a row with identical recorded input.

Why it may matter: Repeating an unchanged action can use more time and tokens without trying a new approach.

Prevent it next time: After two identical attempts, inspect the result and change the input or approach before trying again.

What the evidence cannot prove: This proves repetition, not that the repeated action was unnecessary or failed.

Repeated pattern: The review can say this recurred after it appears in at least 3 distinct sessions within 7 days.

## The same failed action was tried again unchanged

- Pattern key: `repeated-identical-error`
- Status: Shown as an issue
- Rule version: 1

What it notices: The same recorded action failed at least twice within the next ten actions. No file change or passing check was recorded between those failures.

Why it may matter: Trying the same failed action again without recorded progress is a useful point to change approach.

Prevent it next time: After the same action fails twice without recorded progress, inspect the error and change the input or approach, or record the blocker before trying again.

What the evidence cannot prove: Some failures may be deliberate tests; this does not prove the retry was unreasonable.

Repeated pattern: The review can say this recurred after it appears in at least 3 distinct sessions within 7 days.

## Several actions failed in a row

- Pattern key: `consecutive-tool-errors`
- Status: Shown as something to watch
- Rule version: 1

What it notices: Three or more recorded actions failed one after another.

Why it may matter: A chain of errors is a useful point to pause before more retries compound the problem.

Prevent it next time: After two failures in a row, pause, inspect them, and change one variable before continuing.

What the evidence cannot prove: The failures may be deliberate tests and may not share a cause.

Repeated pattern: The review can say this recurred after it appears in at least 3 distinct sessions within 7 days.

## Long search streak before the next concrete step

- Pattern key: `search-streak-without-change-or-check`
- Status: Not run
- Rule version: 1

What it notices: Ten searches or file reads occurred in a row without a recorded write or validation command.

Why it may matter: Long exploration streaks are a useful checkpoint because a session can keep gathering context without testing a hypothesis.

Prevent it next time: After ten searches or reads without a change or check, summarize what is known and choose one concrete next step before searching more.

What the evidence cannot prove: This does not prove that any search or read was unnecessary.

If enabled later, its recurrence rule would require at least 3 distinct sessions within 7 days.

Why it is not shown now: In the local audit, 525 of 629 qualifying roots later reached a write or validation; the rule mostly described normal research rather than a problem.

## The same search was repeated

- Pattern key: `repeated-search-query`
- Status: Not run
- Rule version: 1

What it notices: The same normalized search query appeared at least twice within ten actions without an intervening write or compaction.

Why it may matter: Repeating the same search without changing the workspace is unlikely to reveal a different result.

Prevent it next time: Reuse the prior result or change the query, scope, or hypothesis before searching again.

What the evidence cannot prove: External files or search indexes could have changed without a recorded workspace write.

If enabled later, its recurrence rule would require at least 3 distinct sessions within 7 days.

Why it is not shown now: Promotion needs reliable resets for writes, compactions, successful state changes, and external-data refreshes across every source.

## The same file was read repeatedly without a recorded change

- Pattern key: `same-file-reread-without-recorded-change`
- Status: Shown as something to watch
- Rule version: 1

What it notices: The same file was read at least three times within ten actions, with no recorded change to that file between reads.

Why it may matter: Repeated full reads can put already-read material back into the session's working context.

Prevent it next time: Before reading the same file again, record what fresh information is needed; prefer a narrower range when only one section matters.

What the evidence cannot prove: Different ranges, deliberate re-grounding, and unrecorded external changes can make a reread useful.

Repeated pattern: The review can say this recurred after it appears in at least 3 distinct sessions within 7 days.

## The final code change had no later recorded check

- Pattern key: `last-change-not-checked`
- Status: Measured only
- Rule version: 1

What it notices: The session changed a source-code file and did not record a passing test, type check, or lint check afterward.

Why it may matter: The saved evidence cannot show that the final version of the code passed a relevant check.

Prevent it next time: After the last code change, run the narrowest relevant check; if no check applies, record that reason explicitly.

What the evidence cannot prove: A useful check may be unrecognized, and some code-like changes may not require an executable test.

If enabled later, its recurrence rule would require at least 3 distinct sessions within 7 days.

Why it is not shown now: The final local measurement found only 14 Codex examples, below the approved minimum of 20 examples for every supported trace family.

## The last recorded check was still failing

- Pattern key: `last-check-still-failing`
- Status: Measured only
- Rule version: 1

What it notices: For at least one kind of test, type check, or lint check, the last recorded result was a failure.

Why it may matter: The recorded evidence ends with a known failing check.

Prevent it next time: Fix the failure and rerun the check, run a narrower relevant check, or record the blocker before ending the session.

What the evidence cannot prove: A failing check can be an intentional test written before the fix, or a blocker the user accepted.

If enabled later, its recurrence rule would require at least 3 distinct sessions within 7 days.

Why it is not shown now: The final local measurement found only three examples in total, too few to judge whether the recommendation is dependable across trace families.

## An action has no recorded completion

- Pattern key: `unresolved-tool-call`
- Status: Not run
- Rule version: 1

What it notices: One or more tool calls still have a recorded running status at the end of the transcript.

Why it may matter: The trace does not contain a final result for those actions.

Prevent it next time: Before ending, verify or cancel every action that lacks a recorded terminal result.

What the evidence cannot prove: The transcript may have been captured while work was still running; do not call the action abandoned.

If enabled later, its recurrence rule would require at least 3 distinct sessions within 7 days.

Why it is not shown now: A running status can mean an active capture, a truncated transcript, or an adapter pairing gap; no cross-source terminal-session proof exists yet.

## Many changes were made without a recorded plan

- Pattern key: `many-writes-without-recorded-plan`
- Status: Not run
- Rule version: 1

What it notices: At least five file writes occurred without a preceding structured plan or TODO tool call when that tool surface was available.

Why it may matter: A short plan can keep a multi-change task from losing requirements or verification steps.

Prevent it next time: Before a task that needs several changes, record a short ordered plan and keep it current as work changes.

What the evidence cannot prove: The task may be simple enough that a separate recorded plan would add no value.

If enabled later, its recurrence rule would require at least 3 distinct sessions within 7 days.

Why it is not shown now: Prose plans and planner-tool availability differ by agent, and many bounded tasks legitimately need no separate structured plan.

## The session cycled around the same failed edit

- Pattern key: `failed-read-write-oscillation`
- Status: Not run
- Rule version: 1

What it notices: For one file, at least two read-write-read cycles contain a middle write explicitly labeled failed or reverted.

Why it may matter: Repeatedly returning to the same failed edit is a strong sign that the current approach needs a new hypothesis.

Prevent it next time: After a failed edit cycle repeats, stop editing, restate the failure evidence, and choose a different change before continuing.

What the evidence cannot prove: No claim is emitted while failed and reverted write effects are incomplete.

Why it is not shown now: Cross-source write failure and reversal effects are not normalized reliably enough.

## Working context grew back near its earlier size after being reduced

- Pattern key: `context-refill-cluster`
- Status: Shown as an issue
- Rule version: 1

What it notices: The session reduced its working context at least twice. Within five turns each time, the recorded working-context size grew back to at least 80% of its earlier high point.

Why it may matter: Repeatedly returning to a large working context can make one session expensive and harder to steer.

Prevent it next time: Split unrelated tasks into separate sessions. After context is reduced, bring back only evidence needed for the current task.

What the evidence cannot prove: The trace does not prove that the refilled context was old, unnecessary, or unrelated to new work.

Repeated pattern: The review can say this recurred after it appears in at least 3 distinct sessions within 7 days.

## Short replies used a higher-priced option

- Pattern key: `short-tool-free-turn-cost`
- Status: Shown as a cost opportunity
- Rule version: 1

What it notices: One or more replies used no tools, were 120 output tokens or fewer, and have a cheaper same-provider price calculation for the exact recorded tokens.

Why it may matter: The same recorded token volume has a lower list-price arithmetic result, although task quality is unknown.

Prevent it next time: Keep short replies minimal. If your setup can route work by price tier, consider its lower-cost option for this narrow kind of reply.

What the evidence cannot prove: A short answer can still require difficult reasoning; this never claims another model would complete the task.

Repeated pattern: The review can say this recurred after it appears in at least 3 distinct sessions within 7 days.

## A tool returned a very large recorded output

- Pattern key: `large-tool-output`
- Status: Not run
- Rule version: 1

What it notices: A single tool result crossed a frozen recorded-size threshold in a source that preserves output completeness.

Why it may matter: Large outputs can fill context with material that is not needed for the next decision.

Prevent it next time: Narrow the command, file range, or result limit so the next run returns only the evidence needed.

What the evidence cannot prove: Recorded characters are not tokens, and a large output can be necessary.

Why it is not shown now: Adapters and source stores truncate or omit output differently, so recorded character counts are not comparable enough even for shadow promotion work.

## A shell command duplicated an available structured tool

- Pattern key: `shell-over-structured-tool`
- Status: Not run
- Rule version: 1

What it notices: A shell read or search command was used while an equivalent structured tool was exposed.

Why it may matter: Structured tools can provide more bounded and consistently recorded evidence.

Prevent it next time: Prefer the available structured read or search tool when it can express the same bounded request.

What the evidence cannot prove: No finding is emitted because shell use can be the correct scaffold convention.

Why it is not shown now: External evidence shows this mainly reflects the agent scaffold, not a per-session failure.

## Completion was stated without a later recorded check

- Pattern key: `unsupported-completion-claim`
- Status: Not run
- Rule version: 1

What it notices: Final assistant text matches a completion phrase and no successful recognized validation follows the last source write.

Why it may matter: Completion language is not evidence that the final code was checked.

Prevent it next time: Tie completion statements to a recorded passing check or state clearly that verification was not run.

What the evidence cannot prove: No assistant text is ingested or rendered for this detector.

Why it is not shown now: The normalized model intentionally omits assistant prose, and a fixed text regex would still not prove the claim false.

## The session repeatedly switched between the same work phases

- Pattern key: `semantic-phase-oscillation`
- Status: Not run
- Rule version: 1

What it notices: The same two semantic phases alternate at least three times within six actions.

Why it may matter: Repeated switching can indicate that the current hypothesis is not converging.

Prevent it next time: Pause after repeated phase switches, state one hypothesis and its decisive check, then follow that path before switching again.

What the evidence cannot prove: Never run this detector in the deterministic product path.

Why it is not shown now: Published versions require model-generated semantic phase labels and would violate deterministic zero-model-call operation.

## Exploration did not connect to later implementation

- Pattern key: `semantic-fruitless-exploration`
- Status: Not run
- Rule version: 1

What it notices: At least four of five semantically labeled code reads never appear in a later implementation step.

Why it may matter: Exploration that never informs a change can consume context without narrowing the task.

Prevent it next time: After several exploratory reads, summarize which evidence changes the implementation plan and drop paths that do not.

What the evidence cannot prove: Never run this detector in the deterministic product path.

Why it is not shown now: Published versions require model-generated semantic labels and later-intent judgments.

## Work moved outside a reference change scope

- Pattern key: `reference-scope-drift`
- Status: Not run
- Rule version: 1

What it notices: Recorded writes target files outside an explicit reference or gold change set.

Why it may matter: Unexpected scope expansion is a useful review checkpoint when a valid reference exists.

Prevent it next time: Before changing files outside the agreed scope, record why the expansion is necessary and verify the added surface.

What the evidence cannot prove: Do not infer task scope from a single session or live repository state.

Why it is not shown now: A single local session has no trustworthy gold or successful reference scope.

## A change was quickly overwritten or reversed

- Pattern key: `reference-relative-rapid-rewrite`
- Status: Not run
- Rule version: 1

What it notices: A file write is overwritten or reversed within three actions and a valid reference run does not show the same rewrite.

Why it may matter: Quick reversals can identify unstable edits that deserve a more explicit hypothesis.

Prevent it next time: Before rewriting the same change again, state what the previous edit disproved and run a focused check.

What the evidence cannot prove: No single-session finding is emitted because rapid correction can be healthy work.

Why it is not shown now: A quick rewrite can be normal; published disambiguation requires a reference run.

## Recorded tasks were still open at the end

- Pattern key: `open-task-at-end`
- Status: Not run
- Rule version: 1

What it notices: The latest trustworthy structured task snapshot contains pending or in-progress items at session end.

Why it may matter: Open tracked work can be forgotten when the session is treated as complete.

Prevent it next time: Before ending, complete each open task or record its blocker and next concrete action.

What the evidence cannot prove: Never treat a stale task snapshot as current state.

Why it is not shown now: Structured task state is not normalized and sampled snapshots can be stale after later activity.

## An interrupted operation had no recorded resumption

- Pattern key: `interrupted-work`
- Status: Not run
- Rule version: 1

What it notices: An explicit interrupted or aborted event has no later matching resumed completion.

Why it may matter: Interrupted work can leave a partial change or missing result behind.

Prevent it next time: After an interruption, resume the operation or record the blocker and the next safe action.

What the evidence cannot prove: A truncated transcript may omit a completion that occurred later.

Why it is not shown now: Explicit interruption lifecycle events are not normalized consistently across sources.

## A child result was not recorded as delivered to its parent

- Pattern key: `subagent-delivery-gap`
- Status: Not run
- Rule version: 1

What it notices: A child run records completion but the parent trace has no matching delivery event.

Why it may matter: Completed delegated work can be lost if its result never reaches the parent session.

Prevent it next time: Before ending, confirm that every completed child result was received or record which delivery failed.

What the evidence cannot prove: Do not infer delivery failure from child existence alone.

Why it is not shown now: Child lifecycle and parent-delivery evidence are not normalized across sources.
