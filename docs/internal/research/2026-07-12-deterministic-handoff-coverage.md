# Archived continuity research — not the session-review feature

**Date:** 2026-07-12
**Code baseline:** `origin/main` at `a13f11a` (`aireceipts-cli` v0.8.2)
**Scope:** Claude Code, Codex, and opencode-family local transcripts
**Privacy:** aggregate counts and schema facts only. No prompt, output, repository,
path, command, secret, or task text was retained in this report.

> **Archived after scope correction, 2026-07-12:** the maintainer clarified that the
> feature currently called `--handoff` is a post-session review: detect concrete issues
> and recommend prevention so they do not recur. It is not a work-resumption brief.
> Everything below about plans, pending tasks, interruptions, next actions, or
> successor-session continuity is preserved research for a separate possible feature
> and is **disabled** for session review. The canonical corrected investigation is
> [`2026-07-12-deterministic-session-review.md`](./2026-07-12-deterministic-session-review.md).

## Archived decision

Do not build the continuity packet described in this document as part of session
review. Structured plans, interrupted work, working-set mutations, and successor next
steps answer “how do I resume?”, not “what should I prevent next time?” Combining them
would dilute the review and recreate the naming confusion.

The event-ledger mechanics and corpus measurements remain useful if a separately named
continuity feature is proposed later. Every such line would still need to say what was
*recorded*, not what the task “really” needs.

For the requested full-corpus evaluation, one prerequisite comes before renderer work:
current default opencode discovery sees one session, while the alternate local app root
held 4,118 `session` rows in a dated inventory. Existing root configuration makes 3,432
rows eligible by filename but current product loading returned 3,257 summaries; a
non-prefixed database has another 686 session rows but returns zero because its schema
omits session-level columns the adapter's summary SQL assumes. Until discovery and
compatible-schema support are fixed or configured, a better handoff cannot
reach almost any of that corpus.

For a separate future continuity feature, the highest-value recorded facts would be:

1. explicit plan/TODO state with a freshness distance;
2. structured interruption and tool-completion state;
3. verification outcome relative to later mutations;
4. mutation-backed working set;
5. transcript-chain, compaction-tail, and subagent-delivery integrity.

Free-text “decisions,” inferred goals, and guessed next steps stay preserved here but
disabled. None of the five items above belongs in the session-review registry's active
set.

## Discovery note

**Problem.** The shipped handoff tells the next run about three flagged-pattern
classes and recurring static rules. It does not reliably say where work stopped.

**Value hypothesis.** A small packet of recorded open work, stop state, last fresh
verification, and mutation evidence reduces successor rediscovery without a model
call or semantic guess.

**Load-bearing assumption.** The three local formats record these facts often enough,
and with sufficiently unambiguous lifecycle semantics, to justify the packet's
limited visual budget.

**Cheapest decisive test.** Scan the maintainer's corpus read-only, measure each
candidate's prevalence and freshness, then manually audit positive and adversarial
negative samples without retaining their content. A candidate that cannot be phrased
as a transcript fact is omitted.

**Adopt vs. build.** Adopt the recurring field taxonomy and bounded ordering from
public handoff protocols. Build the extractor locally because aireceipts alone has to
join these vendor-specific on-disk formats while preserving I1–I6, offline operation,
and byte stability.

## Current-main audit

The current flow is:

```text
load Session
  → buildFullSessionReceiptModel
  → aggregate recent waste
  → renderHandoff / toHandoffJson
```

The limiting seams are concrete:

- `src/receipt/handoff.ts:252` gates the human packet on
  `model.wasteLines.length > 0`; no waste plus no suggestion returns the sentinel.
- `src/cli/commands/handoff.ts:29` passes only `ReceiptModel`, recurrence
  suggestions, and turn/tool/compaction counts to the renderer.
- `src/parse/types.ts:58` already preserves tool name, input, output, status, and
  timestamps across the target adapters.
- `src/parse/types.ts:193` carries usage-fidelity and compaction facts but no task,
  interruption, verification, file-event, or transcript-chain state.
- `src/receipt/json.ts:262` exposes richer pricing and subagent accounting, but no
  work-continuity facts.

The shipped packet has one handoff golden based on a Claude loop fixture. There is no
byte golden for a clean session, Codex handoff, opencode handoff, compaction-bearing
handoff, interrupted session, or structured plan.

### Existing facts that need no adapter schema change

- exact tool outcome counts, with `running` phrased only as “no recorded completion”;
- last/longest tool and tool sequence;
- turn and compaction spacing;
- already-computed cost-shape facts;
- Claude-only low-confidence same-file reread facts;
- parent and readable-subagent cost/token totals.

### Facts that need normalization or a vendor-specific derived layer

- structured plan/TODO snapshots;
- explicit turn interruption/abort state;
- verification command and exit-status events;
- canonical file mutations and diffstat;
- message-parent reachability and out-of-order tool results;
- compaction result/tail metadata beyond `{turnIndex, atMs}`;
- cross-agent subagent delivery state.

### Correctness issues found beside the coverage gap

These should not be silently folded into new claims:

- The stuck-loop detector proves repeated identical invocations, not that every
  invocation failed. Current rule wording says “failures” and overstates the evidence.
- The trivial-span detector proves only tool-free output at or below its token bound
  with a cheaper cited row. It does not prove the content was an acknowledgment or a
  single-line reply.
- Missing titles fall back to `sessionId`, which can be an absolute transcript path in
  text and JSON. Existing field-name privacy tests do not catch content smuggled
  through that field.
- Child cost is rolled into the header, but child findings do not feed the handoff's
  parent-only waste lines or coverage.
- The recent-window scan reloads all in-window sessions with unbounded `Promise.all`;
  new selected-session facts should not add another corpus-wide pass.

## Local trace corpus

The first read-only scan covered 9,653 transcript files or database rows. The stores
were active; a later root-only snapshot used for the shipped-detector comparison had
473 Claude roots, 727 Codex roots after excluding 90 explicit children, and 4,081
database roots after excluding 37 `parent_id` children.

| Corpus | Scanned | Structured plan/TODO | Final open snapshot | Open snapshot predating later activity | Explicit interruption or incomplete call | Recorded file mutation | Verification command |
|---|---:|---:|---:|---:|---:|---:|---:|
| Claude Code | 4,719 JSONL (473 parent, 4,246 sidechain) | 82 | 14 | 12 | 20 explicit interrupted-message markers | 567 | 326 |
| Codex | 816 JSONL | 53 | 25 | 20 | 14 `turn_aborted(interrupted)` | 141 | 194 |
| opencode-family | 4,118 DB session rows | 906 | 203 | 86 | 91 running/pending tool states | 1,469 | 663 |
| **Total** | **9,653** | **1,041** | **242** | **118** | **125** | **2,177** | **1,183** |

The categories overlap and must not be summed as unique-session coverage.

### What the counts mean

- Structured task state exists in 10.8% of the full corpus. It is not universal, but
  1,041 real observations are not an edge-case fixture.
- A final open snapshot appears in 242 sessions. Of those, 118 precede later mutation
  or verification activity. That does **not** prove the plan is wrong; it proves a
  freshness caveat is load-bearing.
- Recorded mutations appear in 22.6% of the corpus and verification commands in
  12.3%, giving a larger potential coverage gain than open plans alone.
- Explicit interruption/incomplete-call evidence is rarer (1.3%) but high-severity:
  it identifies the exact sessions where a successor most needs a stop-state fact.

### Current handoff baseline and candidate delta

Current-main's real parsers and detectors found current-session pattern evidence in
130/473 Claude roots (27.5%) and 30/727 Codex roots (4.1%). The other 343 Claude and
697 Codex roots receive only generic recent-window suggestions today—output exists,
but it carries no session-specific resume fact.

A conservative operational-candidate union (exact task state, interruption/in-flight
state, recorded verification result, terminal exact-invocation failure,
repository-status observation, or incomplete task event) exists in:

| Root corpus | Candidate present | Present where current session has no pattern evidence |
|---|---:|---:|
| Claude Code | 101/473 (21.4%) | 53/343 (15.5%) |
| Codex | 529/727 (72.8%) | 504/697 (72.3%) |
| alternate database root | 1,159/4,081 (28.4%) | baseline unavailable because product discovery misses this corpus |

The broad union includes failure-like signals that may be expected probes. The safer
individual facts are last recorded task state, structured verification outcome,
explicit interruption/in-flight state, and mutation counts.

### Vendor-specific joins

- Claude's current task surface uses TaskCreate/TaskUpdate. Task identifiers must be
  joined through structured tool results and later updates; the older whole-list TODO
  assumption does not fit the sampled parent traces.
- Codex uses a whole-list `update_plan` snapshot with `pending`, `in_progress`, and
  `completed` statuses. Its official prompt and source define that schema.
- The opencode-family database stores relational TODO rows with content, status,
  priority, order, and timestamps. Latest rows are already the materialized task state.

No task should be marked complete merely because a similarly named file changed.

## The opencode-family discovery prerequisite

Current-main's adapter chooses one root: an explicit constructor root, then
`OPENCODE_DATA_DIR`, then the upstream default. In the observed shell, the default
root contains three matching databases and one product-visible session.

The alternate local app root contains 20 top-level SQLite databases and, in the dated
inventory, 4,118 `session` rows:

- 19 filenames pass `^opencode.*\.db$` and contain 3,432 session rows; the current
  product returned 3,257 full summaries from them in 5.45 seconds at about 398 MB
  maximum RSS on the measured machine;
- one non-prefixed database contains 686 session rows and `message`/`part`, but the
  product returned zero: its `session` table omits `model`, `path`, and aggregate token
  columns that `summarySql()` currently selects;
- table names alone are therefore not a sufficient compatibility oracle.

This is a combination of root selection, filename filtering, and optional-column
compatibility. A safe fix should:

1. accept an explicit additional root or documented multi-root configuration;
2. inspect only top-level SQLite files in those known roots;
3. qualify candidates read-only by required tables **and columns**, with explicit
   safe fallbacks for optional session-level fields;
4. sort and deduplicate roots, databases, and session IDs deterministically;
5. never recursively ingest arbitrary SQLite files.

For the maintainer's corpus, this is the highest-leverage coverage correction. It also
needs a runtime/memory gate: making thousands of sessions reachable but unusably eager
would move the failure rather than fix it.

## External evidence loop

### Pass 1 — formats and mechanics

Primary sources show that the required facts exist as structured events rather than
needing a generated summary:

- [Claude Code sessions](https://code.claude.com/docs/en/sessions) describes local
  JSONL with messages, tool calls, and metadata; its
  [hook lifecycle](https://code.claude.com/docs/en/hooks) distinguishes resume, clear,
  and compact.
- [Claude Code context behavior](https://code.claude.com/docs/en/how-claude-code-works)
  warns that detailed early instructions can disappear during compaction.
- [Codex protocol source](https://github.com/openai/codex/blob/c888e8e75a9f0e90ce7d5517f8b9540832cbbf76/codex-rs/protocol/src/protocol.rs)
  defines turn completion/abort, compaction, command, plan, and collaboration events
  with correlation IDs.
- [Codex plan source](https://github.com/openai/codex/blob/c888e8e75a9f0e90ce7d5517f8b9540832cbbf76/codex-rs/protocol/src/plan_tool.rs)
  defines explicit plan statuses.
- [OpenCode compaction source](https://github.com/anomalyco/opencode/blob/cf7503687a2485621a690d18c4b0d1ff2060bc3e/packages/opencode/src/session/compaction.ts)
  records a bounded tail and compaction state; its
  [session summary source](https://github.com/anomalyco/opencode/blob/cf7503687a2485621a690d18c4b0d1ff2060bc3e/packages/opencode/src/session/summary.ts)
  computes file diffs from snapshots.
- [Gemini CLI TODOs](https://geminicli.com/docs/tools/todos/) and
  [checkpointing](https://geminicli.com/docs/cli/checkpointing/) independently use
  structured task state and couple recovery to recorded tool/worktree state.
- [OpenAI Agents SDK handoffs](https://github.com/openai/openai-agents-python/blob/main/docs/handoffs.md)
  separates handoff metadata, application state, history filtering, and summarization.

### Pass 2 — recurrent failure shapes

GitHub title searches on 2026-07-12 found recurring compaction, resume-context,
handoff, and session-summary reports across all three ecosystems. Raw counts are only
a recurrence signal; they include duplicates and unrelated cases.

| Title query | Codex | Claude Code | OpenCode |
|---|---:|---:|---:|
| `compaction` | 208 | 710 | 195 |
| `resume` + `context` | 14 | 70 | 1 |
| `handoff` | 25 | 54 | 7 |
| `session` + `summary` | 2 | 57 | 17 |

High-signal examples cover old instructions becoming active again, recent work after a
compaction disappearing, completed commands being repeated, subagent completion not
reaching the parent, and message-parent chains becoming unreachable:

- [task intent regresses after resume](https://github.com/openai/codex/issues/8310)
- [post-compaction tail disappears](https://github.com/openai/codex/issues/9198)
- [historical prompt appears active](https://github.com/openai/codex/issues/27731)
- [completed command re-executes](https://github.com/openai/codex/issues/28874)
- [recent files and verification target are lost](https://github.com/openai/codex/issues/29356)
- [subagent completion is lost](https://github.com/openai/codex/issues/26728)
- [compressed history conflates review with approval](https://github.com/anthropics/claude-code/issues/41148)
- [parallel results break export/resume order](https://github.com/anthropics/claude-code/issues/42290)
- [dangling parent links hide transcript entries](https://github.com/anthropics/claude-code/issues/58554)
- [resume uses the wrong recorded directory](https://github.com/anomalyco/opencode/issues/28581)

Community discussions were used only for pain language and priority, not technical
claims. Users repeatedly ask for changed files, unverified work, rejected approaches,
uncertainty, and the next safe action. Two high-engagement examples describe
[old work replay after compaction](https://www.reddit.com/r/codex/comments/1uoc7ky/codex_forgets_what_it_was_doing_after_an_auto/)
and [operational state disappearing while refetchable tool output survives](https://www.reddit.com/r/ClaudeCode/comments/1qcjwou/figured_out_why_compact_loses_so_much_useful/).

The experimental [Handoff Debt study](https://arxiv.org/abs/2606.02875) reports that
context-bearing takeovers reduce median successor events by 20–59% and prompt tokens
by 42–63% relative to repository-only takeover. Its stable claim is reduced
rediscovery effort, not guaranteed task success.

## Ranked deterministic candidate ledger

### Tier 0 — prerequisite truth fixes

1. **Multi-root, column-qualified opencode discovery.** Highest corpus reach; includes
   optional-column compatibility and a runtime/memory gate before any handoff
   fact can serve the alternate store.
2. **Safe handoff identity.** Never fall back to an absolute transcript path in a
   paste-ready label or JSON identity.
3. **Correct detector wording.** Say repeated attempts where failure was not observed;
   describe trivial spans by their actual predicate.

### Tier A — enable after trace calibration

1. **Transcript continuation integrity.** Duplicate IDs, missing parents,
   begin-without-end, end-without-begin, reachable-tail counts, and out-of-order results.
2. **Latest explicit task ledger.** Latest-write-wins by task ID or whole-list
   replacement according to the source contract; exact recorded statuses and order.
3. **Completed-turn/idempotency fence.** Structured completion/abort state prevents a
   historical prompt from looking like fresh work.
4. **Pending gates.** Unanswered user questions, permissions, approvals, and blocked
   task entries, paired by correlation ID.
5. **Verification freshness.** Narrow command allowlist, structured exit status, and a
   count of later recorded mutations.
6. **Mutation-backed working set.** Successful structured edit/write/patch events,
   repo-relative only, ordered by last mutation.
7. **Compaction recovery ledger.** Result state plus the recorded tail after the last
   compaction.
8. **Subagent delivery ledger.** Spawn, completion, parent delivery, and compaction
   between spawn/delivery.
9. **Failure and recovery chronology.** Same canonical action fails then succeeds;
   exact chronology, no explanation of *why*.

### Tier B — useful but lower priority

- recorded cwd/worktree/model/permission timeline, without reading live Git state;
- content hash prefix, format version, record counts, timestamp bounds, and parse-drop
  provenance;
- child waste rollup into the parent's handoff once cross-agent lineage is normalized;
- structured compaction retained-tail counts when adapters expose them;
- session-chain and collision facts only after false-positive gates are proven.

### Preserve but keep disabled

These candidates are retained so they are not rediscovered and accidentally shipped
without evidence:

- possible user correction or constraint;
- possible decision with rationale;
- possible repeated post-compaction mutation;
- possible scope/task switch;
- frequently reread file as a resume recommendation;
- possible stale assumption;
- assistant-stated next step extracted from prose.

Each future candidate should carry a rule version plus source indices/event IDs. It
earns a renderer only after positive and adversarial-negative trace review.

### Rejected

- Model-generated handoff prose: violates I1 and can flatten authorization,
  conditions, or rationale.
- Live `git status`, filesystem inspection, issue lookup, or repo indexing in the
  renderer: same transcript could produce different bytes.
- Inferring plan completion from changed files or an assistant saying “done.”
- A single “resume-ready” score: hides distinct failure modes and creates false
  confidence.
- Full raw transcript in the packet: duplicates sensitive content and recreates the
  context-size problem.
- Automatic semantic retrieval across sessions: corpus-dependent and not a stable
  function of one transcript.
- Absolute path output: unsafe in a pasteable artifact.

## Output contract

When the event ledger lands, order the facts by successor value:

1. active recorded task and freshness;
2. pending gates and interruption/open turn;
3. last completed-turn fence;
4. mutation-backed working set;
5. verification freshness;
6. failures and recovery;
7. compaction/subagent continuity warnings;
8. detector slip and provenance.

The ordering follows the practical implication of
[Lost in the Middle](https://arxiv.org/abs/2307.03172): do not bury the facts a
successor needs first in the middle of a long packet.

Every line must be one of:

- an exact recorded enum/status;
- a count over explicitly defined events;
- a bounded, sanitized excerpt labeled as recorded text;
- a fixed rule tied to an already validated detector.

Missing evidence produces omission or `not recorded`, never inference.

## Value gates

For each increment:

1. measure candidate presence on the full corpus by vendor;
2. measure the absolute increase in non-empty, substantive handoffs over the shipped
   detector-only behavior;
3. manually audit a stratified positive sample and adversarial negatives;
4. require zero privacy leaks and zero claims stronger than the source event;
5. pin clean, interrupted, missing-result, out-of-order, stale-verification,
   compaction-tail, and malformed-record cases in fixtures/goldens;
6. verify identical bytes across cwd, timezone, locale, and live filesystem state.

Suggested kill criterion for a rendered fact: cut or keep it disabled if it adds less
than five percentage points of substantive handoff coverage on the reachable parent
corpus *and* has no high-severity recovery case, or if a 100-positive stratified audit
finds more than one incorrect factual claim. High-severity continuity violations may
survive the prevalence threshold, but never the accuracy threshold.

## Provisional build order

1. For the requested combined-corpus loop, fix or explicitly configure the
   opencode-family discovery/schema gap and prove the adapter reaches the intended
   corpus deterministically within a measured resource budget. This is not a generic
   dependency for event-ledger development—the already reachable Claude, Codex, and
   database traces suffice for that—but it is required for a representative verdict on
   this maintainer's full corpus.
2. Draft the handoff event-ledger spec against the now-reachable corpus. Start with the
   smallest cross-vendor state set that clears the coverage and accuracy gates.
3. Add transcript-continuity and interruption facts before any free-text excerpt.
4. Add verification freshness and mutation-backed paths only with strict command/path
   privacy rules.
5. Leave semantic candidates shadow-only until a later trace loop proves them.

This sequence is deliberately value-gated. It preserves the full research frontier
without making the public packet carry claims the transcript cannot yet defend.
