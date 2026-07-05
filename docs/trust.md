# What a receipt proves — and what it can't

aireceipts is local-first: it reads agent transcripts off your disk and prints
a receipt. That design is why it needs no accounts or servers — and it is also
the exact boundary of what a receipt can claim. This page states both sides
plainly. (SPEC-0028.)

## What a receipt proves

- **The records existed on the author's machine.** Every number is computed
  from transcript files found locally at render time — never from a guess, a
  prediction, or a remote service.
- **The dollars come from cited, dated price tables.** A `$` renders only when
  a `data/prices/<vendor>.json` row — carrying its `sources:` citations —
  matches the session's model and date. No matching row means tokens are shown
  instead. A receipt's prices can be audited back to the vendor page they were
  copied from.
- **The rendering is deterministic.** The same transcript and price tables
  produce a byte-identical receipt, on any machine (`--methodology` describes
  the attribution; goldens and a determinism gate enforce it in CI).
- **Incompleteness is labeled.** A PR receipt that could not attribute every
  candidate session renders its totals as a floor (`TOTAL priced ≥ $X`) and
  counts the sessions it left out. A number that might understate says so in
  the number.

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

## What makes fabrication visible

- **Reconciliation** (`node scripts/cost-reconcile.mjs`): each adapter that
  registers a fidelity validator is checked against its agent's own
  accounting — Codex sessions must sum exactly to the rollout's cumulative
  token envelope; Claude Code sessions must satisfy usage-shape invariants.
  Drift is printed, named, and fails the gate.
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

1. **A contributing session leaves no proof.** `git commit --quiet`,
   cherry-picks, or filtering the SHA out of push output leave no branch SHA
   in any tool output — the session is excluded and the total renders as a
   floor (`≥`). Understates; marked by the floor and the
   "not attributed" note. (Observed live on PR #61 and PR #66.)
2. **Rows round; the total doesn't.** Each row shows its own rounded cents
   while TOTAL formats the raw sum, so hand-adding rows can differ from the
   total by up to about half a cent per priced row. Bounded and enforced by
   the ledger property test; exact values live in `--json`.
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
6. **Slices are anchor-bounded.** Work before a session's first branch commit
   or after its last may fall outside the counted turn range; the slice line
   states the exact range so the boundary is inspectable.
7. **Subagent rollups are window-bounded.** A child straddling the slice
   window counts if its launch or finish lands inside; a child that cannot be
   parsed is listed as unreadable, priced at nothing, and floors the total.
8. **Price tables age.** Rows are dated and cited, with a daily drift
   tripwire — but a receipt rendered before a price correction reflects the
   table it cited that day. Re-render to re-price.
9. **Vendor accounting is only as checkable as the vendor makes it.** Codex
   sessions reconcile exactly (tolerance 0) against the rollout's own token
   envelope; Claude Code transcripts carry no independent total, so only
   shape invariants apply there.
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
    anchor are silently ignored rather than rendered as `entire session`.
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

13. **An anchor-pool session that only full-falls-back** (SPEC-0044 A1). A
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

15. **Cache-write cost is a lower bound when the vendor's price row cites no
    cache-write rate** (SPEC-0044 A3, row-aware). An unsplit (or partially
    split) cache-write turn is priced under the assumed 5m-tier rate — and
    that's *exact*, not a caveat, whenever the price row cites
    `input_cache_write_5m` (every Anthropic model does, so Claude Code sessions
    never trip this, split or not). It's a genuine under-report only for
    vendors whose price row cites no cache-write rate at all (openai, google,
    deepseek today — every opencode session touching one of those models
    inherits the gap; opencode's own schema has no tier-split concept, but that
    alone isn't the trigger). *Direction:* under-report. *Marker:* the total
    floors `≥`, the single-session receipt carries a muted "cache-write cost is
    a lower bound for this session" caveat, and the PR body's confidence
    summary counts affected sessions. Fires only on the fallback's actual use
    against an uncited rate — a session priced entirely against vendors that
    cite the applicable tier rate, or with no cache-write at all, never trips
    it. Details: [cost-model.md](cost-model.md).
15. **A session we couldn't read** (SPEC-0044 B4). A candidate in the branch
    window whose transcript failed to load, sitting outside the current
    worktree, used to vanish silently — "couldn't read" is not the same as
    "read and found it isn't ours". It is now counted: the total floors `≥` and
    a note reads "N session(s) touched this branch but couldn't be read". (A
    read-but-unproven session is still a correct silent skip; only a genuine
    read *failure* trips this.)
16. **A transcript with records skipped at parse time** (SPEC-0044 B3). A
    malformed or crash-truncated record (a torn JSONL line, a corrupt DB row)
    is skipped while the rest of the session parses fine. When such a session is
    credited, its total is a lower bound: the receipt says "N unreadable
    transcript record(s) skipped — total may be incomplete" and the PR total
    floors `≥`. A clean transcript never trips it.
17. **A session that failed to parse before it was even a candidate**
    (SPEC-0045). B4 (#15) catches a candidate whose full transcript won't load;
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
