# What a receipt proves — and what it can't

aireceipts is local-first: it reads agent transcripts off your disk and prints
a receipt. That design is why it needs no accounts or servers — and it is also
the exact boundary of what a receipt can claim. This page states both sides
plainly. (SPEC-0028.)

## What a receipt proves

- **The records existed on the author's machine.** Every number is computed
  from transcript files found locally at render time — never from a guess, a
  prediction, or a remote service.
- **The dollar floors come from cited, dated price tables.** A `$` renders only when
  a `data/prices/<vendor>.json` row — carrying its `sources:` citations —
  matches the session's model and date. No matching row means tokens are shown
  instead. Every computed amount is labeled `≥` and means "observable tokens at
  the Standard API list price," not "this was your invoice." The arithmetic can
  be audited back to the vendor page the row was copied from.
- **The rendering is deterministic.** The same transcript and price tables
  produce a byte-identical receipt, on any machine (`--methodology` describes
  the attribution; goldens and a determinism gate enforce it in CI).
- **Incompleteness is labeled.** Every dollar is a Standard API-equivalent floor.
  A PR receipt that could not attribute every candidate session also counts the
  sessions it left out; missing price coverage stays in a separate token ledger.

## What a receipt cannot prove

- **That the transcript is untouched.** Transcripts are plain JSONL on the
  author's disk. The author can edit them, and no local-first tool can detect
  every edit — a tool that could would need attestation infrastructure and a
  server, which aireceipts refuses by design. A PR receipt is therefore the
  **author's disclosure**, like a changelog entry: normally honest, verifiable
  in its arithmetic, but not cryptographic evidence.
- **That nothing is missing.** A session that never touched the branch — or
  hid its tracks (no commits) — may be absent. Absent sessions make totals
  *under*state, which is why known gaps render as floors, never as bare
  numbers.
- **What the vendor invoiced.** Local traces generally omit the decisive
  commercial context: API key versus subscription, Standard versus another
  service tier, region, negotiated discounts, credits, gateway markup, and
  sometimes provider-side usage such as cache writes. Codex in particular has
  no persisted auth/billing route, cache-write count, provider request id,
  explicit dollar, or request-to-invoice join key. Exact token reconciliation
  therefore does not create invoice evidence. `≥ $X` is a reproducible Standard
  API list-price-equivalent observation, not billing reconciliation.

## What makes fabrication visible

- **Reconciliation**: Codex also enforces request evidence in the normal
  receipt path. Non-monotone totals, changed-total/`last` disagreement, mixed
  usage schemas, dropped records, or a request sum that misses the final local
  envelope disable all request-level pricing and leave an explicit tokens-only
  caveat. The separate `node scripts/cost-reconcile.mjs` maintainer check still
  validates normalized Codex totals and Claude Code usage-shape invariants.
- **Time-integrity caveats**: a receipt whose turns claim timestamps after the
  transcript file's own modification time, or whose span is non-positive while
  carrying usage, renders a `caveat:` line and a `caveats` entry in `--json`.
  Caveats never change a `$` — they are facts attached to the number.
- **Determinism**: anyone with the transcript can re-render the receipt and
  compare bytes.

## Where the numbers can go wrong

*A living list (maintainer directive, 2026-07-03): every newly discovered
scenario gets an entry here in the same PR that handles it — the doc test
pins this section and its minimum size, so removing an entry fails CI.
Each entry names the scenario, the direction of the error, and the marker
that makes it visible on the receipt.*

1. **A contributing session leaves no proof** (`silenced-git-write` or
   `unanchored-git-write`). `git commit --quiet`,
   cherry-picks, or filtering the SHA out of push output leave no branch SHA
   in any tool output — the session is excluded and the total renders as a
   floor (`≥`). Understates; marked by the floor and the
   "not attributed" note. (Observed live on PR #61 and PR #66.)
2. **Displayed floors never round upward.** Every human `≥ $X` is floored
   independently: two decimals for an exact-cent value, four when fractional
   cents remain. No cent is redistributed between rows, so displayed
   rows are not promised to add exactly to the independently floored TOTAL.
   Raw `--json`/`--csv` values retain full precision and carry lower-bound
   semantics explicitly. *Direction:* prevents an over-claim caused solely by
   rounding. *Marker:* `≥` on every human dollar plus `CostEstimate`/CSV basis.
3. **Unpriced models show tokens, never dollars.** No dated, cited price row →
   tokens only; a mixed receipt renders `$` and token subtotals separately,
   never blended.
4. **Cursor sessions carry totals only.** No per-turn usage exists in the
   transcript, so per-tool attribution is impossible; the receipt says so
   verbatim rather than splitting by guesswork.
5. **Helper crediting is a heuristic.** A no-commit Codex session in the
   current worktree during the branch window is credited on cwd+time —
   unrelated concurrent Codex work in the same worktree could over-credit.
   Grouped under `CODEX HELPERS — no commits`, never presented as an author.
6. **Slices are anchor-bounded.** Work before a session's first proven branch
   boundary or after its last may fall outside the counted range; the slice
   line states the exact turns. Same-diff commit/amend aliases now preserve the
   pre-amend window (#239). A directly captured final `git commit --amend`
   proves same-session lineage even when content changed; if the final branch
   SHA is not captured, the amend remains unprovable and floors rather than
   guessing.
7. **Subagent rollups are window-bounded** (`unreadable-subagent`). A readable
   child is included whole when its observable interval intersects the parent's
   range, including when the child spans the range. A sliced parent with no
   observable start/end has an unknown window and includes no readable child
   cost. A child that cannot be parsed is still listed as unreadable, priced at
   nothing, and floors the total; missing evidence does not disappear with the
   window.
8. **Price tables age.** Rows are dated and cited, with a daily drift
   tripwire — but a receipt rendered before a price correction reflects the
   table it cited that day. Re-render to re-price.
9. **Vendor token accounting is only as checkable as the vendor makes it.** A
   priceable Codex session reconciles exactly (tolerance 0) against its local
   cumulative envelope after replay deduplication and inherited-baseline removal;
   a failed stream is preserved only as unattributed tokens. Claude
   Code transcripts carry no independent total, so only shape invariants apply.
   Neither result establishes invoice cost: Codex omits cache-write usage,
   request ids, auth mode, and a billing join key; Claude's local cost fields are
   client estimates when available and are not persisted in the transcript path
   aireceipts reads.
10. **Transcripts are editable.** See above — time-integrity caveats surface
    some inconsistencies, not all edits.
11. **A quoted SHA is not authorship** (found live on our own PR #87,
    2026-07-04: a subagent's completion report quoted its commit SHA into the
    lead session's transcript, and the lead's entire day — ~$965 — was
    credited to a one-commit PR). Direction: over-credit, potentially by
    orders of magnitude. Fix shipped with this entry: anchors are accepted
    only from adapter-flagged real shell executions AND only from output
    lines matching git's own write grammars (`[ref sha]`, `old..new`,
    `sha -> ref`); cross-project sessions that cannot be sliced to a commit
    anchor are counted as unattributable and floor the receipt rather than
    rendered as `entire session`.
12. **A fork inherits its parent's context, not its parent's bill.** Fork
    transcripts reference inherited history; pricing a fork must count only
    post-fork turns or the parent's spend double-counts. Direction:
    over-credit. The adapter cuts at the fork marker, so every downstream
    stage — anchors, slicing, per-commit tables, rollups — sees only the
    fork's own work; a fork with no marker would render nothing rather than
    a summed-inherited receipt.

If you need a stronger guarantee than an author's disclosure — billing-grade
attribution across a team — use your vendor's console. aireceipts will not
pretend to be that, and a receipt that pretended would be worth less than one
that tells you exactly what it knows.

13. **An anchor-pool session that only full-falls-back**
    (`unattributable-anchor-pool`, SPEC-0044 A1). A
    session from another repo/worktree that touched this branch but resolves only
    to "entire session" (push-only or rebased anchor, no sliceable commit) is too
    uncertain to credit. *Direction:* under-credit. *Marker:* the total floors
    `≥` and a **distinct** note — "N session(s) touched this branch but couldn't
    be attributed precisely" — counts it, separate from the "candidate session
    not attributed" note. Previously such a session vanished with no trace: the
    silent mirror of #87's over-credit. Details: [cost-model.md](cost-model.md).

14. **Cursor Background Agents are not read** (SPEC-0044 A2, known gap). The
    Cursor adapter reads inline Composer sessions but not Background Agent
    sessions (`agentKv:`/`glass.` keys). *Direction:* under-report a whole
    contributor. *Marker:* none yet — a documented blind spot pending its own
    spec (PR-scoping needs the background-agent schema). Details:
    [cost-model.md](cost-model.md).

15. **An uncited cache rate contributes zero, never a guessed input rate**
    (`cost-lower-bound-cache-tier`, SPEC-0044 A3, row-aware). Cached reads need a
    cited `input_cached` rate. Cache writes need the applicable cited specific or
    generic write rate; an unsplit write may use the documented 5m assumption
    only when that 5m/generic rate is actually present. A missing applicable
    rate makes that observed cache component contribute $0 to the floor. The
    historical event name covers both read and write gaps. *Direction:*
    under-report by construction rather than risk fabricating an over-large
    floor. *Marker:* every total already renders `≥`; the receipt also says
    "some observed cache tokens have no cited applicable rate — floor excludes
    them," and the PR confidence summary counts affected sessions. A request
    with no affected cache tokens, or a row citing every applicable rate, never
    trips it. Details: [cost-model.md](cost-model.md).
16. **A session we couldn't read** (`unreadable-session`, SPEC-0044 B4). A candidate in the branch
    window whose transcript failed to load, sitting outside the current
    worktree, used to vanish silently — "couldn't read" is not the same as
    "read and found it isn't ours". It is now counted: the total floors `≥` and
    a note reads "N session(s) touched this branch but couldn't be read". (A
    read-but-unproven session is still a correct silent skip; only a genuine
    read *failure* trips this.)
17. **A transcript with records skipped at parse time**
    (`dropped-transcript-records`, SPEC-0044 B3). A
    malformed or crash-truncated record (a torn JSONL line, a corrupt DB row)
    is skipped while the rest of the session parses fine. When such a session is
    credited, its total is a lower bound: the receipt says "N unreadable
    transcript record(s) skipped — total may be incomplete" and the PR total
    floors `≥`. A clean transcript never trips it.
18. **A session that failed to parse before it was even a candidate**
    (SPEC-0045). B4 (#16) catches a candidate whose full transcript won't load;
    this catches the same failure one layer earlier — at *discovery*, where a
    file that can't be parsed would otherwise be dropped before the PR flow sees
    it. If its lazy metadata places it in **this repo**, it is flagged exactly
    like #15 (floors `≥`, counted as an unreadable session). **The honest
    limit:** a transcript so corrupt that even its lazy metadata (the working
    directory) is lost cannot be tied to any particular repo, so it is excluded
    without a per-receipt note — flagging it would fire on any corrupt file
    anywhere under your agent's data directory, PR-relevant or not. A degraded
    file is likewise excluded from every non-PR view (`week`, `compare`,
    `--list`, budget), which never render an incomplete total for it.
19. **Codex replay snapshots, inherited baselines, and model switches**
    (fixed 2026-07-10). Re-booking an unchanged cumulative snapshot overstates;
    treating a fork's parent-inclusive final total as local overstates; freezing
    the first model can under- or over-price later turns. The adapter now ignores
    replay vectors, derives later turns from cumulative differences, subtracts
    the inherited baseline, and stamps each delta with its active model. A
    changed delta must equal its non-zero `last_token_usage`; totals must stay
    componentwise monotone; legacy/cumulative schemas may not mix; dropped
    records or a final sum mismatch invalidate the whole request stream. The
    local envelope then remains as unattributed tokens and no request dollar is
    emitted. *Marker:* the receipt's request-reconciliation caveat plus the
    zero-tolerance fidelity gate; 40/40 recent
    sessions reconciled after the fix.
20. **Context tier is selectable only at the scope the vendor defines.** For
    GPT-5.6, every changed Codex cumulative envelope is retained as a persisted
    request usage unit inside its user-facing turn, and the >272K Standard tier
    is selected per unit. Aggregating a whole tool-loop turn would be wrong: in
    a content-free scan of 792 rollouts and 51,465 changed request envelopes,
    136 of 216 GPT-5.6 turn groups would falsely cross 272K only after
    aggregation; no intra-turn model/provider switch was observed. Codex also
    omits the cache-write token count, so the correctly tiered amount remains a
    lower bound. GPT-5.5's official page scopes the multiplier to the "full
    session"; a request stream or PR slice cannot select that scope soundly, so
    GPT-5.5 remains deliberately tokens-only.
21. **Request-local identity gates the price key** (fixed 2026-07-10).
    Every pricing unit uses its own model, provider field, and timestamp; it
    never borrows identity or date from the enclosing turn/session. Codex
    `model_provider` and opencode message `providerID` override model-prefix
    inference on that unit. Recognized direct providers select their own cited
    table; routed OpenRouter/Bedrock/Azure and custom providers remain
    tokens-only. Only a unit with no provider field uses legacy inference from
    its own model/source; a missing model or timestamp blocks pricing.
    This prevents routed traffic from inheriting a plausible-looking
    first-party dollar.
22. **opencode itemized usage can trail its stored session aggregate.** The
    coherent stored aggregate is compared with the itemized message sum by
    component. If the aggregate dominates in every bucket, its exact excess
    becomes a separate, explicitly unpriced `(unattributed usage)` bucket. A
    full receipt includes it; a partial turn slice excludes it with a counted
    caveat. If the vectors cross (aggregate higher in some buckets, lower in
    others), componentwise-max reconciliation would create a vector neither
    source reported. The adapter instead keeps the itemized total and exposes
    only the positive aggregate-only components as conflicting/excluded
    evidence; they enter neither total tokens nor the floor. No path fabricates
    a turn, request, model, tool, or provider. OpenCode's stored `cost` is a
    models.dev client calculation, not an invoice.
23. **Claude duplicate ids can carry evolving usage.** One `message.id` remains
    one observable assistant response group, but first-wins under-counted when
    later records raised output. Following Anthropic's documented rule, the
    adapter retains the complete usage record with the highest output count
    (later record wins a tie) and deduplicates tools by `tool_use.id`, preserving
    each distinct call and result once. It does **not** maximize token buckets
    independently, which could create a vector no trace record ever contained.
    A local content-free audit found 34,095 affected ids and 23,260,537 output
    tokens missed by first-wins accounting. Without a `message.id`, the trace
    cannot distinguish repeated snapshots from distinct responses. Those tools
    remain visible, but all id-less usage becomes one coherent highest-output
    unattributed envelope and contributes no dollar.
24. **A mixed-price PR atom must live in both ledgers**
    (`partial-priced-coverage`, fixed 2026-07-10).
    A contributor or subagent with one priced turn and one unknown-model turn
    used to show its known `$` while its unpriced tokens vanished from `TOTAL
    unpriced`. The attribution layer now carries the exact unpriced turn usage
    separately; the PR renders both totals, floors the dollar line, and counts
    sessions with partial price coverage.
25. **Malformed usage must never become a dollar.** Non-finite, negative, or
    fractional token components, inconsistent totals, and cache-tier subsets
    larger than cache creation are rejected at the shared pricing boundary.
    The turn remains tokens-only; price-delta/trivial-span side paths use the
    same guard, so they cannot reintroduce a negative/NaN/fabricated `$`.
26. **A transcript or subagent tree that is absent leaves no evidence.** If the
    agent never persisted the file, or the file/directory was deleted or moved,
    the CLI cannot distinguish that from “no such work happened.” *Direction:*
    under-report. *Marker:* none is possible without inventing a contributor;
    this is the unresolved evidence limit behind issue #161.
27. **A still-running commit call may not have written its result yet.** Posting
    a receipt from inside the same in-flight tool call that performs `git commit`
    can race the transcript write, leaving the final SHA unavailable to the
    selector. *Direction:* under-report. *Marker:* an unanchored/excluded floor
    may fire only if enough of the call was already persisted. Generate the
    receipt after the committing call returns.
28. **A future Codex cumulative reset has no evidence-backed normalization
    rule.** None occurred in 47,944 audited `token_count` events. A decreasing
    envelope now fails the normal-path evidence gate: request-level pricing is
    disabled and the final local envelope is retained as unattributed tokens.
    No reset behavior is guessed. *Direction:* conservative under-pricing.
    *Marker:* request-reconciliation caveat.
29. **The handoff headline is a heuristic pattern subtotal, not savings.**
    Stuck-loop and context-thrash findings can cover the same tokens, while
    trivial-span dollars are counterfactual re-pricing rather than observed
    cost. `FLAGGED PATTERN COST ≈ $X` therefore takes the largest priced
    stuck-loop/context-thrash class subtotal, excludes trivial-span re-pricing,
    and never adds overlapping classes. The `≈` and the adjacent "heuristic
    pattern subtotal · not proven savings" are mandatory: the detector cannot
    prove avoidability, so even this overlap-safe amount is not a savings floor.
    Its legacy `pctOfTotal` machine field is always `null`. *Direction:* no
    directional savings claim. *Marker:* the disclaimer below the headline.
30. **Trivial-span repricing is all-or-nothing per request unit.** Every unit in
    the candidate turn must carry its own model/date/provider evidence, resolve
    to the agent's direct source vendor, and have a cited row above the comparison
    row. One missing, routed, or mismatched unit suppresses the dollar finding;
    a partial turn is never presented as fully repriced. *Direction:* conservative.
    *Marker:* no trivial-span finding when the evidence gate fails.
