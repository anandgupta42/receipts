# Deterministic session review: issue detection and prevention

**Date:** 2026-07-12
**Code baseline:** `origin/main` at `396de73`
**Research snapshot:** 5,255 root sessions across Claude Code, Codex, and
opencode-family stores
**Final implementation measurement:** 5,394 frozen root sessions, measured twice
**Privacy:** only aggregate counts and structural facts were retained. No prompt,
assistant response, tool input/output, command, path, repository name, or secret is
included here or in the proposed registry.

## Scope correction

The feature currently named `--handoff` should answer one question:

> What went wrong or could be improved in this session, and what should I do next
> time so it is less likely to happen again?

It is **not** a resume brief, task-state summary, or continuity packet. Those ideas
remain preserved in the archived
[`2026-07-12-deterministic-handoff-coverage.md`](./2026-07-12-deterministic-handoff-coverage.md)
research, but they are disabled for this product surface.

## Decision

Rename the public command to `aireceipts review`. Keep the old flag as a hidden alias
for existing scripts; both invocations enter the same implementation and emit the new
review output.

`review` is the clearest term for a completed-session check. `handoff` implies moving
work to another person or session, which caused the exact scope confusion corrected
above. `improve` sounds as if the command will change files, `audit` sounds like a
formal compliance process, and `lessons` does not promise evidence.

The review should render each finding in plain language:

1. **What happened** — a narrow statement directly supported by recorded events.
2. **Why it matters** — the practical consequence, without claiming causality.
3. **Prevent it next time** — one fixed, actionable recommendation.

The detector catalog should be a versioned JSON registry keyed by stable pattern ID.
The JSON owns titles, descriptions, recommendations, fixed thresholds, rollout state,
capability requirements, caveats, impact role, and recurrence policy. TypeScript owns
the bounded extractor functions referenced by ID; arbitrary rules are not interpreted
from JSON.

## What current code actually proves

The audit found several places where today's wording is stronger than its evidence:

- The repeated-call detector proves at least three consecutive calls with equal tool
  name and normalized input. It does not inspect failure status, yet the recommendation
  calls the attempts failures. Missing recorded inputs can also compare equal.
- The short-turn detector proves only that a turn was tool-free, produced at most 120
  recorded output tokens, and has deterministic same-token repricing. It cannot tell
  whether the reply was an acknowledgment, restatement, or easy reasoning task.
- The context detector proves that prompt load returned to at least 80% of an earlier
  peak within five turns after each of at least two nearby compactions. It does not
  prove that old or unnecessary context was rebuilt.
- One numeric field currently mixes three incompatible meanings: an attributed share
  of observed spend, an observed prompt window, and a same-token alternative price.
  Summing or ranking these as one savings/waste figure is invalid.
- Pattern identity, recommendations, recurrence templates, JSON unions, renderers,
  schemas, and telemetry enums are enumerated in separate places. They can drift.
- The empty result `nothing to hand off` means only that the supported detectors did
  not fire. It does not prove that the session had no problem.
- A missing display title can fall back to a path-shaped session identifier. A review
  must not render that fallback.

These are correctness repairs, not merely copy changes. The first implementation must
fix them before adding more patterns.

## Local trace study

The read-only root-session snapshot contained:

| Source family | Root sessions | Product parser currently reaches |
|---|---:|---:|
| Claude Code | 445 | 445 |
| Codex | 729 | 729 |
| opencode-family databases | 4,081 | 3,233 |
| **Total** | **5,255** | **4,407** |

The stores were active during research: Claude roots changed between passes while
Codex grew. The table above is the final pass, not an immutable benchmark. A promotion
run must first freeze the file list and read-only database copies.

The 848 unreachable database roots are a separate discovery/schema-compatibility
problem described in draft SPEC-0082. Seventeen of twenty alternate databases have a
valid older schema without optional session-summary columns; the current summary query
selects those columns unconditionally and drops the database on error. This is a
coverage prerequisite for full-corpus dogfood, not a reason to mix continuity facts
into session review.

### Coverage measurements

| Deterministic signal | Sessions | New beyond today's patterns | Interpretation |
|---|---:|---:|---|
| Today's three pattern classes | 171 | — | Current session-specific baseline |
| Same failed tool+input recurred within ten actions, with no write/check between | 34 | 26 | Strong issue when input and status are explicit |
| At least three consecutive explicit tool errors | 90 | 71 | Neutral checkpoint; probes may intentionally fail |
| No successful recognized check after the final source write | 755 | 729 | Largest gain, but classifier must pass adversarial audit |
| At least ten searches/reads without write or check | 629 | 626 | Disabled: 525 later reached a write/check; only 25 ended in the streak |
| Same normalized search repeated in ten actions | 89 | 86 | Disabled until all freshness boundaries are normalized |
| Same-file reread churn | 30 | 14 | Existing low-confidence neutral diagnostic; source coverage is partial |
| A recorded `running` call anywhere / as the final call | 213 / 161 | 182 / 145 | Disabled: active and truncated captures look the same |
| Recorded single output at least 100,000 characters | 26 | 9 | Disabled: source truncation makes counts incomparable |

The union of strict failed retry, three consecutive errors, and the safer post-write
validation gap covered 830 of 5,255 roots, 789 of them new beyond the current detector
set. Combining that candidate union with current patterns produced 960 unique roots:

- current baseline: **171 / 5,255 = 3.25%**;
- measured result if the tail-check classifier passes promotion: **960 / 5,255 =
  18.3%**, a 15.0 percentage-point increase.

The broad 958-root “post-write and final-five overlap” variant was rejected: 203 of its
firings had already recorded a successful validation after the final source edit, just
outside the arbitrary final-five window. The safer 755-root rule asks only whether any
successful recognized validation follows the final source edit.

These are detector-coverage counts, not proof that every firing is a mistake. Removing
the tail-check candidate leaves only 95 new roots, so that rule is the value gate: it
must be audited and promoted safely or the first release does not achieve the requested
coverage increase.

### Final implementation measurement

The approved implementation was measured after SPEC-0082 made every discovered root
loadable. The harness froze one sorted input list, evaluated it twice with bounded
concurrency, and retained aggregate structural counts only. Both passes produced the
same digest; all 5,394 roots loaded and discovery stayed unchanged during the run.

| Result | Sessions | Reach | Gain over baseline |
|---|---:|---:|---:|
| Existing three-pattern baseline | 172 | 3.19% | — |
| User-visible registry rules | 220 | 4.08% | +0.89 points |
| Visible plus the two hidden tail checks | 1,183 | 21.93% | +18.74 points |

The hidden `last-change-not-checked` rule found 33 Claude Code, 14 Codex, and 959
opencode-family examples. The approved accuracy gate requires at least 20 real positives
from every supported trace family before recommendation review. Codex has only 14, so
the audit cannot meet its minimum even if every available example is correct. The
second hidden rule found only three examples in total. Both remain shadow-only, render
nothing, and send no telemetry.

This is the intended outcome of the gate, not a reason to weaken it. Visible coverage
does not meet either shipping threshold, so the implementation must not claim that
coverage increased and SPEC-0083 remains building. The aggregate measurement is stored
in
[`measurements/session-review-2026-07-12.json`](./measurements/session-review-2026-07-12.json).

### Classifier boundaries

- **Repeated identical attempt:** consecutive calls only; tool name and canonical JSON
  input must both be present and equal. Never call it a failure without explicit error
  statuses.
- **Repeated identical error:** the same present canonical tool/input fails twice
  within ten tool actions, with no direct write or recognized successful validation
  between. Deliberate negative probes remain possible.
- **Consecutive errors:** at least three adjacent calls with explicit error status.
  Present as “things to watch,” not waste or a common-cause verdict.
- **Search streak:** at least ten adjacent canonical SEARCH/FILE_READ actions, with no
  canonical write or validation. The local result proves it is usually exploration,
  so the recommendation is a checkpoint, not “stop wasting searches.”
- **Repeated search:** keep disabled until writes, compactions, successful state changes,
  and external-data refreshes all provide reliable reset boundaries. Never preserve or
  render the query.
- **Tail validation:** a canonical source write occurs after the last successful
  recognized validation, or there is no recognized validation. Documentation-only and
  generated-file cases require explicit exclusions. It remains shadow-only until a
  stratified positive/negative audit meets the promotion gate.
- **Unresolved calls:** disabled until a source proves both terminal capture and correct
  tool-call/result pairing.
- **Large output:** disabled until sources expose comparable completeness metadata.

## External research loop

The strongest source is the July 2026 paper
[What Resolve Rate Hides: Trajectory Structure Diagnostics for Coding Agents](https://arxiv.org/html/2607.06184).
It evaluates 2,500 trajectories across five settings and three scaffolds, and publishes
reproducible definitions for search loops, reread churn, tool oscillation, tail
validation, unsupported completion claims, structured-plan absence, shell-over-tool,
and redundant search. Its most transferable exact signal was the search loop, but the
paper also warns that prevalence and outcome association vary by environment and that
trajectory diagnostics are not per-run causal explanations. That warning is why this
proposal separates issues, neutral diagnostics, shadow rules, and disabled research.

Other primary implementations independently support exact structural matching:

- [StrongDM's coding-agent loop specification](https://github.com/strongdm/attractor/blob/main/coding-agent-loop-spec.md)
  uses a tool-call signature of tool name plus arguments and detects repetition in a
  rolling window before suggesting a different approach.
- [AgentRE-Bench](https://github.com/agentrebench/AgentRE-Bench) defines redundant tool
  calls using identical tool name and arguments.
- [ZeroClaw's configuration reference](https://github.com/zeroclaw-labs/zeroclaw/blob/master/docs/reference/api/config-reference.md)
  exposes bounded loop detection and exemptions for intentionally repeated tools.
- [Understanding Software Engineering Agents](https://www.software-lab.org/publications/ase2025_trajectories.pdf)
  treats the same action with the same parameters—such as rerunning a test without a
  code change—as a recognizable recurrence, while leaving semantic linkage to richer
  analysis.

The registry shape follows established rule-system practice without copying an
execution model. [ESLint custom rules](https://eslint.org/docs/latest/extend/custom-rules)
separate rule metadata, schemas, message IDs, and suggestions; the
[OpenTelemetry semantic-conventions specification](https://opentelemetry.io/docs/specs/semconv/)
shows why stable keys, shared meanings, and versioned schemas matter. Here, the JSON is
metadata and frozen scalar configuration only; deterministic TypeScript extractors
remain reviewable code.

Reddit reports were used only to improve plain-language phrasing around repeated
rereads, context growth, and completion without checks. They were not used to validate
any detector or threshold.

## Pattern registry

The canonical research registry is
[`2026-07-12-session-review-pattern-registry.json`](./2026-07-12-session-review-pattern-registry.json).
It contains 23 preserved patterns: 4 default findings, 2 neutral diagnostics,
2 shadow-only candidates, and 15 disabled ideas.

| Pattern key | State | User-facing meaning |
|---|---|---|
| `repeated-identical-attempt` | enabled | The same action ran three times unchanged |
| `repeated-identical-error` | enabled | The same failed action was retried unchanged |
| `context-refill-cluster` | enabled | Prompt load returned near its prior peak after nearby compactions |
| `short-tool-free-turn-cost` | enabled | Deterministic same-token price opportunity for narrow tool-free turns |
| `consecutive-tool-errors` | diagnostic | Several explicitly failed actions occurred in a row |
| `same-file-reread-without-recorded-change` | diagnostic | The same file was reread without a recorded same-file change |
| `last-change-not-checked` | shadow | The last source change had no later recognized successful check |
| `last-check-still-failing` | shadow | The final recognized check was still failing |
| `search-streak-without-change-or-check` | disabled | Local audit showed mostly normal exploration |
| `repeated-search-query` | disabled | Cross-source freshness resets are incomplete |
| `unresolved-tool-call` | disabled | Running status lacks terminal-capture proof |
| `large-tool-output` | disabled | Recorded size lacks cross-source completeness proof |
| `many-writes-without-recorded-plan` | disabled | Planner availability and prose planning are not comparable |
| `failed-read-write-oscillation` | disabled | Failed/reverted write effects are not normalized |
| `shell-over-structured-tool` | disabled | Availability is scaffold-specific, not universal |
| `unsupported-completion-claim` | disabled | Requires semantic text inspection forbidden by the product path |
| `semantic-phase-oscillation` | disabled | Requires a model labeler |
| `semantic-fruitless-exploration` | disabled | Requires a model labeler |
| `reference-scope-drift` | disabled | Requires a trusted reference solution |
| `reference-relative-rapid-rewrite` | disabled | Requires a trusted reference solution |
| `open-task-at-end` | disabled | Belongs to continuity and task-state analysis |
| `interrupted-work` | disabled | Belongs to continuity and lacks cross-source lifecycle normalization |
| `subagent-delivery-gap` | disabled | Belongs to continuity and lacks a safe parent-delivery join |

“Enabled” above means implemented for the approved slice, not shipped. Shadow rules run
only in local dogfood and never render or enter telemetry. Disabled rules remain in the
registry with `extractor: null`; they are not silently discarded.

## Registry contract

Each pattern value contains:

- a stable `ruleVersion` and rollout state/reason;
- plain `title`, `description`, `whyItMatters`, and one canonical `recommendation`;
- an extractor ID plus frozen scalar parameters, or `null` when disabled;
- required source capabilities and evidence strength;
- a `claimLimit` that constrains text and tests;
- one impact role: `observed-attributed`, `observed-window`,
  `same-token-reprice`, or `none`;
- recurrence eligibility and thresholds;
- overlap/supersession and deterministic order.

The production TypeScript layer should validate the JSON at startup/build time, map
extractor IDs to typed pure functions, and fail closed on an unknown ID, missing
capability, invalid parameter, or unsupported registry version. The registry is the
only enumerator used by per-session detection, recurrence, text, JSON, schemas, docs,
and tests. Detector code may compute evidence; it may not carry another copy of the
recommendation.

Raw prompt/response text, commands, tool input/output, paths, and repository names are
forbidden both in rendered evidence and in registry-driven telemetry. Evidence may
contain counts, turn indices, fixed enums, sanitized tool names, capability coverage,
and explicitly labeled impact values.

Impact roles are not interchangeable:

- `observed-attributed`: a documented allocation of observed session spend;
- `observed-window`: observed spend in a qualifying window, not proven avoidable;
- `same-token-reprice`: arithmetic for the same recorded tokens on another cited row,
  not a prediction that another model would finish the task;
- `none`: no dollar impact.

No total may sum values across these roles, and no combined value may be labeled
“wasted,” “avoidable,” or “saved.”

## Plain-language output

```text
SESSION REVIEW

1 thing to improve

1. The same failed action was tried again unchanged
   What happened: The same recorded action failed 3 times.
   Why it matters: Repeating it unchanged did not produce a recorded success.
   Prevent it next time: After the same action fails twice, inspect the error and
   change one variable or record the blocker before trying again.
   Evidence: 3 attempts · turns 14–16

1 thing to watch

1. Several actions failed in a row
   What happened: 3 recorded tool calls ended with an error consecutively.
   Why it matters: This is a useful point to pause before another retry.
   Prevent it next time: Inspect the recorded failures and change one variable before
   continuing.
   Note: The failures may be deliberate probes and may not share a cause.

Coverage: 7 checks ran · 2 were unavailable for this transcript format
```

When nothing supported fires, use:

```text
SESSION REVIEW
No supported issues found in the recorded evidence.
Coverage: 7 checks ran · 2 were unavailable for this transcript format.
```

This avoids both a false clean bill of health and unexplained silence.

## Implemented slice and gate outcome

1. Introduce `aireceipts review`, retain hidden `--handoff`, and replace resume-oriented
   headings and empty-state language.
2. Land the validated registry plus typed extractor map as the single source of pattern
   identity, copy, thresholds, recurrence, ordering, and impact semantics.
3. Correct the existing repeated-attempt, context-refill, and short-tool-free rules.
4. Add strict repeated-error as an issue and consecutive-errors as an explicitly
   caveated diagnostic. Reuse the existing low-confidence same-file reread fact as a
   diagnostic without turning it into waste or savings.
5. Tail-validation and final-failing-check extractors run in shadow. Thirty-six
   adversarial boundary fixtures pass, but the real-positive sample minimum is
   unavailable for every source family, so neither rule is promoted.
6. The final frozen-input measurement reaches 4.08% visibly, only +0.89 points over the
   3.19% baseline. Hidden candidates would reach 21.93%, but accuracy gates come first.
   Keep the coverage objective open and make no increased-coverage claim.
7. Keep search heuristics, plan absence, unresolved calls, large outputs, semantic
   detectors, reference-relative rules, and continuity facts disabled. Their evidence
   remains preserved in the registry.

The approved implementation contract is
[`SPEC-0083-session-review-registry.md`](../../../specs/SPEC-0083-session-review-registry.md).
Its status remains `building` because the measured visible rules do not pass the value
gate.
