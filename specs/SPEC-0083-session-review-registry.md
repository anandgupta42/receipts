---
id: SPEC-0083
title: Session review registry — find repeatable problems and prevent them
status: building
milestone: M6
depends: [SPEC-0013, SPEC-0017, SPEC-0042, SPEC-0043, SPEC-0059, SPEC-0068, SPEC-0082]
---

# SPEC-0083: Session review registry

Invariants: **I1** — every finding is a deterministic local extractor result; zero
model calls and zero product-path network. **I2** — a dollar renders only from a dated
matching price row; otherwise tokens or no impact. **I3** — evidence and impact roles
are traceable, same-token repricing is labeled arithmetic, and no line predicts that a
different model would finish the task. **I4** — the command works offline; no prompt,
response, tool input/output, command, path, repository, finding, recommendation, or
cost enters telemetry, and existing notice/show/opt-out contracts remain. **I5** — text
and JSON are byte-stable golden contracts. **I6** — the review reports recorded facts
and caveated observations, never model or agent rankings and never a causal verdict the
trace cannot support.

## Purpose

Replace the confusing resume-oriented `--handoff` surface with `aireceipts review`: a
plain-language post-session review that identifies a bounded set of recorded problems
and gives one concrete prevention recommendation for each. Pattern identity, wording,
thresholds, rollout, capabilities, recurrence, and impact semantics live in one
versioned JSON registry keyed by stable pattern ID. Deterministic typed extractors
produce the evidence; unsupported and low-value ideas remain visible in the registry
but disabled.

Initial research on a live, privacy-safe snapshot of 5,255 roots identified a promising
tail-check candidate. The final implementation measurement froze 5,394 roots and ran
twice: the visible registry reached 220 roots (4.08%) versus the 172-root baseline
(3.19%). Including hidden tail checks would reach 1,183 roots (21.93%), but the Codex
family contains only 14 `last-change-not-checked` positives—below the approved minimum
of 20 real positives per source family. Both tail checks therefore remain shadow-only,
and this spec remains building without an increased-coverage claim.

Research source:
`docs/internal/research/2026-07-12-deterministic-session-review.md`. Registry prototype:
`docs/internal/research/2026-07-12-session-review-pattern-registry.json`.

**Kill criterion:** do not ship a “coverage increased” claim unless a frozen full-corpus
run reaches both (a) at least 15% of root sessions with a user-visible, session-specific
finding and (b) at least a 10 percentage-point gain over the old three-pattern baseline.
Every promoted rule must have zero factual predicate mismatches in its stratified audit
and at most 10% materially inapplicable prevention advice. A rule that misses either
accuracy gate stays shadow/disabled; if the aggregate coverage gate then fails, the
feature remains building rather than padding coverage with weaker heuristics.

## Requirements

- **R1 — Public command means review, not transfer.** Add
  `aireceipts review [selector]` with the existing selected-session and recent-window
  semantics. Help, docs, examples, PR headings, text headings, and new JSON use
  `review`/`SESSION REVIEW`, never resume-packet language. Keep `--handoff` and
  `--handoff-threshold` as hidden invocation aliases for `review` and
  `--review-threshold`; they emit no warning and enter the same implementation. The
  alias preserves scripts, not old bytes or the old JSON shape. Public help exposes only
  `review` and `--review-threshold`.

- **R2 — One JSON registry is the pattern source of truth.** Production owns
  `src/receipt/review-patterns.json`, shaped as a versioned object whose `patterns`
  object is keyed by stable pattern IDs. Each entry carries `ruleVersion`, rollout
  state/reason, category, plain title/description/why-it-matters/recommendation,
  extractor ID plus frozen JSON parameters or `null`, required capabilities, evidence
  strength, claim limit, impact role/metrics, recurrence policy, supersession, and
  deterministic order. Seed it with all 23 research entries, including disabled ones.
  `src/receipt/reviewRegistry.ts` validates the JSON strictly and maps non-null extractor
  IDs to typed pure functions. Unknown fields, versions, states, capabilities,
  parameters, extractor IDs, or missing implementations fail closed in tests/build.
  JSON is metadata and configuration, not an interpreted expression language.

- **R3 — Registry is the only enumerator.** Per-session detection, recent-session
  recurrence, text, JSON, PR inclusion, ordering, recommendation lookup, schemas, docs
  reference generation, and fixture coverage iterate the registry. Remove the separate
  hand-maintained recommendation and standing-rule tables. The one canonical
  `recommendation` string is reused for a single firing and recurrence; presentation may
  wrap it but may not paraphrase it. Type-level keys derive from the imported JSON or a
  mechanically generated, drift-tested artifact—never a second hand-maintained pattern
  union.

- **R4 — Bounded canonical action layer.** Flatten tool calls in stable transcript order
  and derive local-only action facts without retaining displayable raw content.
  Canonical JSON inputs recursively sort object keys and preserve array order. Identity
  rules require a present tool name and present recorded input. `error` means an explicit
  normalized error status or a retained structured shell result with a non-zero exit
  code; `running` never implies failure. Direct writes are the recognized edit/write/
  notebook/patch tools; source-write classification uses a frozen first-release
  extension allowlist and excludes docs/config/generated/extensionless files. Validation
  recognition uses the existing shell-command lexer (not substring matching), a frozen
  command allowlist for test/type/lint tools, wrappers, and existing structured database
  checks; only recorded success satisfies the check. Per-source capabilities decide
  whether a rule ran, was unavailable, or fired. Missing capability never means “no
  issue.” Raw inputs, outputs, commands, and paths never leave this layer as evidence.

- **R5 — Correct the three shipped detector claims before adding coverage.** The
  repeated-identical-attempt rule requires recorded input, says “attempts” rather than
  “failures,” and attributes observed cost only to triggering attempts after the first
  two; the attribution is never labeled avoidable. Negative duration clamps to zero.
  Context refill says exactly that prompt load returned to at least 80% of the earlier
  peak within five turns after each of two nearby compactions; it never says old or
  unnecessary context was rebuilt. Short-tool-free-turn says only tool-free and at most
  120 recorded output tokens; it removes acknowledgment/restatement/easy-task claims and
  qualifies directly priced same-provider turn units without a source-wide vendor gate.
  Its price is same-token arithmetic, not predicted task success. Recommendations are
  cross-agent and name no vendor-specific project file.

- **R6 — Initial visible additions stay narrow.** Add
  `repeated-identical-error`: the same present canonical tool/input records error twice
  within ten tool actions with no direct write or successful recognized validation
  between. Add `consecutive-tool-errors`: at least three adjacent flattened calls have
  explicit error outcomes; render it under “things to watch” with the caveat that probes
  may be deliberate and causes may differ. Reuse the already-low-confidence same-file
  reread fact under “things to watch,” preserving its source-coverage and legitimate
  re-grounding caveats and keeping it outside waste/savings math. When strict failed
  retry and a generic repeated-attempt/error rule cover the same calls, the registry's
  supersession produces one finding, not stacked advice.

- **R7 — Tail-check rules earn promotion from shadow.** Implement
  `last-change-not-checked` as: a recognized source write exists and no successful
  recognized validation occurs anywhere after the final source write. Do not use the
  rejected “final five actions” variant. Implement `last-check-still-failing` using a
  stable normalized check key. Both start `shadow`: local dogfood computes aggregate
  counts only, renders nothing, and sends no telemetry. Before promotion, freeze the
  input corpus and audit at least 20 positives per supported source family plus at least
  30 adversarial boundary negatives covering documentation/generated writes, intentional
  red-phase tests, a later narrow passing check, wrappers, shell mutations, and
  unrecognized checks. Promotion requires zero predicate mismatches and no more than 10%
  materially inapplicable recommendations. Record only aggregate audit results. A
  semantic or threshold change increments `ruleVersion`.

- **R8 — Preserve rejected insights without running them.** Search streak, repeated
  search, structured-plan absence, unresolved calls, very large output, shell-over-tool,
  unsupported completion claims, semantic phase/exploration rules, reference-relative
  rules, open tasks, interruption, and subagent-delivery entries remain in JSON with
  `rollout.state: "disabled"` and `extractor: null`. The runtime does not execute them.
  Moving a rule from disabled/shadow to visible requires a deliberate registry diff,
  versioned evidence, accuracy audit, tests, and golden review. Continuity facts remain
  preserved in the archived research but are not review findings.

- **R9 — Plain-language, coverage-honest output.** Visible findings group as “things to
  improve,” “cost opportunities,” and “things to watch.” Each prints **What happened**,
  **Why it matters**, **Prevent it next time**, bounded evidence (counts, turn indices,
  fixed enums, sanitized tool names), optional role-labeled impact, and the claim-limit
  note when applicable. No raw session ID/path is a display fallback. The empty state is
  exactly scoped: `No supported issues found in the recorded evidence.` It is followed
  by deterministic coverage: checks run and unavailable pattern IDs/counts. It never
  says clean, no issues, or nothing to hand off.

- **R10 — Impact roles never collapse into one savings number.** Registry impact is one
  of `observed-attributed`, `observed-window`, `same-token-reprice`, or `none`.
  `observed-attributed` is a documented allocation of observed spend;
  `observed-window` is qualifying observed spend with no avoidability claim;
  `same-token-reprice` is cited arithmetic for the same recorded tokens; `none` prints
  no dollar. Text, JSON, PR, recurrence, week, and aggregation surfaces may group or
  subtotal only like-for-like roles when meaningful. They never sum unlike roles or
  label a combined number wasted, avoidable, saved, or “could have saved.” Existing
  legacy fields that imply one recoverable total are removed from the new review schema.

- **R11 — Recurrence uses the same advice.** A recurrence is eligible only when the
  registry permits it and the pattern fires in at least the configured number of
  distinct sessions within its frozen trailing window. It renders the same canonical
  recommendation, prefixed with the distinct-session count and a generic suggestion to
  consider adding it to project instructions. It names no agent-specific instruction
  file, writes nothing, and does not rank sources. Overlap/supersession is applied before
  recurrence counts so one event family cannot inflate two rules.

- **R12 — Versioned JSON is keyed by pattern.** `aireceipts review --json` emits a new
  versioned `review` object with `registryVersion`, source capability coverage, and a
  `findings` object keyed by pattern ID. Each finding contains `ruleVersion`, category,
  fixed copy, bounded evidence, claim limit, optional impact with its role, and
  recurrence; unavailable checks are separate from evaluated non-firings. The export
  omits title/session ID when no privacy-safe label exists and forbids prompt/assistant
  text, tool input/output, commands, paths, repository names, and model-generated
  summaries. The hidden legacy invocation emits this same new schema. Strict export and
  documentation schemas reject unknown keys and enforce text/JSON parity.

- **R13 — Telemetry records use, never findings.** Normalize both invocations to the
  disclosed `review` command class and a `reviewFormat: "text" | "json"` feature enum.
  Do not send pattern IDs, states, counts, coverage, recommendations, evidence, costs,
  source paths, or whether any rule fired. `--telemetry-show`, opt-outs, allowlists, and
  leakage fixtures cover the renamed command. Shadow evaluation is local dogfood only
  and emits no event or payload field.

- **R14 — Determinism, resource bounds, and product coverage.** The selected session is
  parsed once; recent recurrence reuses existing bounded loading and never adds an
  unbounded `Promise.all` or another whole-corpus pass. Same transcript, registry, price
  table, and recent-window snapshot produce byte-identical text/JSON. Add clean,
  each-visible-pattern, overlap, unavailable-capability, Claude Code, Codex,
  opencode-family, compaction, unpriced, and recurrence goldens. The frozen full-corpus
  promotion harness records only source family, booleans/counts, versions, timings, and
  peak RSS; it retains no content/path/model/repository data. Full-corpus reachability is
  supplied by SPEC-0082 before the value gate is claimed.

- **R15 — Public docs teach prevention, not model internals.** Replace the public
  handoff guide and examples with “review a session,” the three plain-language blocks,
  coverage meaning, impact-role explanations, and the scoped empty state. Do not expose
  the hidden aliases in primary help or examples. Generate the pattern reference from
  the production registry so title, recommendation, status, caveat, and threshold cannot
  drift. Historical specs remain historical; the archived continuity report is marked
  non-product research.

## Scenarios

- **Given** a user who wants to learn from a completed session, **when** they run
  `aireceipts review`, **then** they see concrete recorded problems and prevention advice,
  not resume state or guessed next actions.
- **Given** the same failed canonical action twice within ten calls with no write or
  successful check between, **when** review runs, **then** one strict failed-retry issue
  renders and overlapping generic repetition advice is suppressed.
- **Given** three different explicit tool errors consecutively, **when** review runs,
  **then** a caveated “thing to watch” renders without claiming a common cause or waste.
- **Given** a source edit followed by a successful recognized check and six unrelated
  actions, **when** shadow validation runs, **then** the rejected final-five predicate
  does not fire.
- **Given** a final source edit with no later successful recognized check, **when** the
  rule is still shadow, **then** no user output or telemetry changes; after and only
  after promotion gates pass, the fixed prevention finding renders.
- **Given** a long search streak or repeated query, **when** review runs in registry
  version 1, **then** neither disabled rule executes or renders even though its rationale
  remains in JSON.
- **Given** no visible detector firing and two unavailable rules, **when** text review
  runs, **then** it says no *supported* issue was found and reports evaluated versus
  unavailable coverage.
- **Given** a context refill cluster, **when** it renders, **then** it reports the measured
  return to a prompt peak and never claims old or unnecessary context was rebuilt.
- **Given** a directly priced short tool-free turn in a mixed-source session, **when** a
  same-provider lower row exists, **then** same-token arithmetic may render with its
  limitation and no task-success prediction.
- **Given** the hidden legacy invocation and the public command with equal arguments,
  **when** each runs, **then** text/JSON bytes are identical and telemetry classifies both
  as review without revealing which patterns fired.

## Non-goals

- **Resume/continuity output.** Plans, pending tasks, interruptions, next steps, working
  sets, and subagent delivery answer a different product question and are explicitly
  disabled here.
- **Semantic diagnosis.** No prompt/response classifier, embedding, model judge, inferred
  intent, completion-claim scan, or generated recommendation is allowed under I1.
- **A universal quality score.** Detector coverage is not task quality, model quality,
  agent quality, or proof that a task was completed.
- **Causal or counterfactual savings.** A structural pattern does not prove that its cost
  was avoidable or that another approach/model would have succeeded.
- **Automatic instruction edits.** Recurrence suggests a generic prevention rule; it
  never writes project files.
- **Enabling every preserved insight.** Disabled entries are evidence of considered
  ideas, not a backlog commitment or permission to execute them.
- **Solving database discovery inside this spec.** SPEC-0082 owns multi-root and
  compatible-schema loading; it precedes the full-corpus value claim.
- **Changing cited price truth.** Price tables and pricing methodology remain owned by
  the existing pricing specs and mutation gates.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 public surface | `review`, help, docs, PR | review terminology; hidden aliases absent from primary help |
| R1 alias parity | public and hidden invocations | byte-identical new text/JSON, no warning |
| R2 registry valid | 23-entry production JSON | strict parse; stable keys/order/versions |
| R2 invalid registry | unknown state/key/extractor/parameter/version | build/test fails closed |
| R3 single truth | registry recommendation changed in fixture | text, JSON, recurrence, generated docs all change together |
| R4 canonical input | object-key reorder; array reorder; missing input | object reorder equal; array reorder distinct; missing never identity-matches |
| R4 outcomes | explicit error; non-zero structured exit; running; missing | error/error/running/not fabricated |
| R4 capabilities | source lacks canonical validation | rule unavailable, not evaluated-clean |
| R5 repeated attempt | identical calls ×3 with recorded input | “attempts,” triggering-share attribution only, non-negative duration |
| R5 context | two qualifying compaction/refill windows | exact peak-return wording; no rebuild/old-context claim |
| R5 short turn | mixed source, directly priced same-provider units | eligible without source-wide vendor; same-token limitation |
| R6 strict failed retry | same error twice, no progress boundary | one issue; fixed recommendation |
| R6 progress resets | same error, direct write/pass, same error | no strict failed-retry finding |
| R6 consecutive errors | three explicit adjacent errors | caveated watch item, no common-cause claim |
| R6 overlap | identical error run that matches generic rules | one most-specific finding |
| R6 reread | existing low-confidence positive | watch item; no waste/savings subtotal |
| R7 safer tail | source write then pass then six other actions | no tail-gap firing |
| R7 true tail | final source write, no later pass | shadow count only until promotion |
| R7 adversarial audit | frozen positives + boundary negatives | zero predicate mismatch; ≤10% inapplicable advice |
| R8 disabled entries | all 15 disabled patterns | `extractor:null`; never executed/rendered/telemetried |
| R9 clean result | no firing + unavailable capabilities | scoped empty state plus honest coverage |
| R9 privacy | path-shaped ID and leakage fixture | no raw title fallback or forbidden content |
| R10 impact roles | all four roles in one aggregate | unlike roles never summed/ranked as savings |
| R11 recurrence | threshold across overlapping sessions | distinct-session count; one canonical generic recommendation |
| R12 JSON | multiple findings + unavailable rule | findings keyed by stable ID; strict schema/text parity |
| R13 telemetry | text/json, public/hidden, show/off | review class/format only; no finding data; opt-outs hold |
| R14 source goldens | clean + three source families + unpriced | byte-stable text/JSON and correct capability coverage |
| R14 determinism | same fixture/registry/window ×10 | byte-identical output |
| R14 value | frozen full corpus after SPEC-0082 | ≥15% visible coverage and ≥10-point gain, or no ship claim |
| R14 resource | selected session + recurrence + full-corpus harness | one selected parse; bounded scan; sanitized timing/RSS record |
| R15 generated docs | production registry | title/advice/status/caveat/threshold parity; prevention framing |

## Success criteria

- [x] Maintainer approves this draft and SPEC-0082 before implementation/shipping.
- [x] `aireceipts review` is the only public name; hidden aliases enter the same code.
- [x] One strict 23-pattern JSON registry drives detection, recurrence, every renderer,
      schemas, generated reference docs, and recommendation copy.
- [x] Existing repeated-attempt, context-refill, short-turn, cost-role, path-fallback,
      and duration overclaims are fixed and regression-tested.
- [x] Strict failed retry and consecutive errors pass fixtures; tail checks remain
      shadow because R7's real-positive sample minimum is not available for every
      source family.
- [x] Disabled insights remain preserved with `extractor:null` and cannot execute.
- [ ] Frozen corpus reaches ≥15% user-visible coverage and gains ≥10 percentage points,
      with only aggregate privacy-safe measurements committed.
- [x] No unlike impact roles are summed or described as recoverable savings.
- [x] Text/JSON/privacy/telemetry/source/overlap/recurrence goldens and leakage tests pass.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, and `node scripts/hygiene.mjs` all pass unmasked
      (`echo $?`).

## Validation

**2026-07-12 · S1 (code audit): REWORK → incorporated.** The shipped repeated-call
predicate did not inspect failure status and allowed missing inputs to compare equal;
short-turn copy claimed semantic content it never measured; context wording claimed a
cause it never proved; three incompatible impact meanings were summed; recommendations
and pattern unions were duplicated; path-shaped IDs could render. R2–R5 and R9–R12 own
each defect explicitly.

**2026-07-12 · S2 (local trace analysis): REWORK → narrowed.** The final live snapshot
was 5,255 roots, baseline 171 (3.25%). Broad search streaks were common but usually led
to later concrete work, unresolved calls conflated active/truncated traces, output sizes
were source-incomparable, and the final-five tail rule falsely flagged 203 already-
validated sessions. Those ideas moved to disabled. The safer three-rule union covered
830 roots, 789 incremental; combined coverage was 960 (18.3%). R6–R8 and the kill
criterion encode that narrower result. The live-corpus drift found during scanning is
why R7/R14 require a frozen input snapshot.

**2026-07-12 · S3 (worth):** who—any user finishing an agent session and wondering what
to prevent next time; how often—the current product has session-specific evidence in
only 3.25% of the measured roots, while the accuracy-gated candidate reaches 18.3%.
Do nothing—the command remains mostly empty and its transfer-oriented name keeps
misstating the job. Smaller fix—rename plus copy alone fixes comprehension but not
coverage; adding every researched heuristic inflates false positives. The smallest
value-bearing slice is registry + current-detector corrections + strict failed retry +
consecutive errors + accuracy-gated tail validation. Steelman the cut—the validation
classifier may still be too environment-specific; the kill criterion accepts that and
refuses the coverage claim if it fails. **Verdict: approve the draft for implementation
only with its promotion and coverage gates.**

**2026-07-12 · S4 (implementation measurement): KEEP SHADOW.** A frozen sorted list of
5,394 root sessions loaded without failure and produced the same aggregate digest in
two bounded-concurrency passes. Visible rules reached 220 roots (4.08%), a 0.89-point
gain over the 172-root baseline (3.19%), so the R14 value gate is not met. Hidden rules
would reach 1,183 roots (21.93%), but `last-change-not-checked` had only 14 Codex
positives and `last-check-still-failing` had only three examples total. That cannot
satisfy R7's minimum of 20 real positives from every supported source family. Thirty-six
adversarial boundary fixtures have zero predicate mismatches, but the real-positive
recommendation audit remains incomplete. Both rules stay shadow-only and no increased-
coverage claim ships. Aggregate evidence:
`docs/internal/research/measurements/session-review-2026-07-12.json`.
