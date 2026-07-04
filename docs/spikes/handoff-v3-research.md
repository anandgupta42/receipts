# Handoff v3 — deep research (2026-07-04)

Research spike for evolving `--handoff` beyond SPEC-0001 R6 (paste-back block) and
SPEC-0013 (standing-rule suggestions). Sources: full repo inventory, analysis of the
maintainer's real local traces (Claude Code, Codex, altimate-code), and four
independent research sweeps (web ecosystem, academic literature, community
pain-points, Parallel deep-research). All ideas below respect I1–I6: deterministic,
zero model calls, extraction not summarization, no autonomous writes, no model
rankings.

## The one-paragraph thesis

Every handoff tool on the market — Amp's `/handoff`, claude-handoff, handoff-md,
claude-mem, Matt Pocock's handoff skill — calls an LLM to write the handoff, and
users report exactly the fidelity failures you'd expect ("the summary always lost my
instructions"). Every cost tool — ccusage, CodeBurn, claude-receipts — stops at
dollars and does no handoff. Nobody occupies the intersection: a **deterministic,
dollar-denominated resume packet extracted (not generated) from the transcript
already on disk**. aireceipts already owns both halves. Amp retiring compaction in
favor of a first-class handoff primitive (Nov 2025), and Anthropic closing both the
auto-handoff-briefing request (anthropics/claude-code#44200) and the session-cost-
summary request (#18550) as "not planned", validate the demand and leave the lane
open.

*Provenance note: market/literature claims in this doc (tool coverage, star counts,
issue states, paper findings, token-waste percentages) are research-sweep output
with links, not pinned dated citations — verify the specific claim before quoting
it externally or using it as a spec requirement. Repo/trace claims, by contrast,
were verified directly on 2026-07-04.*

## Market facts that shape the design

| Fact | Source | Implication |
|---|---|---|
| Amp (Sourcegraph) retired `/compact` entirely for `/handoff` | ampcode.com/news/handoff, tessl.io | Handoff-over-compaction is now a vendor-validated pattern |
| Anthropic closed handoff-briefing (#44200) and cost-summary (#18550) requests as "not planned" | GitHub issues | Third-party vacuum, explicitly |
| LLM-auto-generated context files reduced task success ~3% and raised cost >20%; human-written improved success ~4% | Gloaguen et al., via iwoszapar.com | Deterministic evidence + human paste beats auto-generated prose — our R4 (no auto-writes) is a feature, not a limitation |
| Agent Analyzer (analyzer.spec-kitty.ai) is the nearest competitor: deterministic local parse, "0 model tokens" | their site | It is forward-only (future rules, no resume packet) and renders reports server-side; full-local + resume packet is our differentiation |
| claude-receipts (617★) prints session-end cost receipts (even on thermal printers) | github.com/chrishutchinson/claude-receipts | The "receipt at session end" artifact has organic pull; it has zero waste/handoff content |
| "Handoff Debt" (arXiv, 2026) defines *rediscovery cost* — re-exploration a successor does that the predecessor already did | arXiv | Gives `--handoff` a measurable success metric |
| AgentDiet: purely heuristic trajectory trimming cut input tokens 40–60% with no performance loss | arXiv | Proof that rule-based (no-LLM) waste detection captures most of the value |
| Re-establishing context costs an estimated 5–20k tokens per session; ~47% of session tokens go to exploration | PROJECTMEM (arXiv:2606.12329); MindStudio field studies | The rediscovery cost is quantifiable — and we can price it in dollars |

## Ground truth from the maintainer's own traces

These came from running the built CLI against real local sessions and reading raw
transcripts (2026-07-04):

1. **Codex compaction records exist and are unparsed.** `~/.codex/sessions` records
   `{"type":"compacted","payload":{replacement_history:[...]}}` plus a
   `context_compacted` event marker — one real session had **96** of them. Our
   `src/parse/codex.ts` extracts none; `src/parse/types.ts` even asserts other
   agents "record no compaction signal", which is false. Codex sessions can never
   fire `context-thrash` today.
2. **`context-thrash` never fired on any sampled real session**, including a Claude
   Code session with 8 raw `compact_boundary` events and the 96-compaction Codex
   session. The K=5-in-25-turns clustering threshold appears mistuned for real
   session shapes.
3. **Verbatim compaction anchors are sitting in the transcripts.** Claude Code:
   `compactMetadata.preservedMessages` (exact list of surviving message uuids) and
   the `isCompactSummary` message text. Codex: `replacement_history` is the literal
   retained transcript. A handoff can quote what survived/dropped with zero inference.
4. **Free deterministic state anchors we ignore today:** `last-prompt` records
   (Claude Code — note `ai-title` is already parsed into `SessionSummary.title`);
   Task-tool TODO state (Claude Code) and a relational `todo` table (altimate-code);
   Codex `turn_aborted{reason:"interrupted"}` ("user bailed mid-turn");
   altimate-code `session.parent_id` (explicit fork/subagent lineage) and
   per-session diffstat columns (`summary_files` etc.).
5. **Session-chain candidates are decodable from paths**: worktree suffix naming
   (`get_ready_for_oss` → `get_ready_for_oss_2`) and same-cwd/branch proximity —
   heuristics needing false-positive gates. `fork-context-ref` is NOT a chain
   signal: SPEC-0038 R4 uses it as a parse-time cut boundary
   (`src/parse/claudeCode.ts:223`), not lineage.
6. **`--list` counts noise as sessions** (workflow journal files with 0 tool calls) —
   any "across your recent sessions" recurrence claim is currently diluted.
7. Real handoff output today is thin: on a $4,059 session it printed two waste
   bullets; on a Codex session it printed only the generic recurring suggestion.

## The opportunity list

Ordered by tier; each item is deterministic (I1), extraction-based, and cites its
grounding. "Day-1" marks items that deliver user-visible value the day they ship.

### Tier A — Make the existing surface true (prereqs; small, high leverage)

- **A1. Parse Codex compactions** into `Compaction[]` (`compacted` +
  `context_compacted` records). Day-1: unlocks context-thrash + all compaction
  features for the second-biggest agent. *(Ground truth #1. Codex review: quoting
  survived/dropped messages needs new normalized fields on `Compaction` — today it
  is only `{turnIndex, atMs}` — plus sanitized fixtures; scope as adapter + model
  change, not a one-liner.)*
- **A2. Retune `context-thrash` against a committed real-session corpus** — the
  detector that feeds handoff's marquee advice never fires in practice. SPEC-0017
  requires threshold justification against a clean corpus with zero false positives,
  so the corpus fixtures come first, then the constants move. Consider per-compaction
  facts (count, trigger, preTokens) as a receipt line even below the thrash
  threshold. *(Ground truth #2.)*
- **A3. Add a standing-rule template for `context-thrash`** (today inline-only by
  SPEC-0017 R7 design). Needs SPEC-0013-grade template evidence — a spec amendment,
  not a free edit. Part of that evidence bar already exists: the committed
  true-positive golden `goldens/claude-code-context-thrash-3x.txt`, and the class
  already flows through `aggregateWaste` with `distinctSessionCount` — the missing
  pieces are the template string, a threshold-crossing fixture, and (per ground
  truth #2) proof it fires on real, not just synthetic, sessions.
- **A6. Parameterize standing-rule templates with `waste.tool`.** The stuck-loop
  template today is one vendor-neutral sentence, identical whether the loop was
  `Bash` (Claude Code), `exec_command` (Codex), or `shell` (opencode). MAST and
  RIMRULE both find under-specified extracted rules are the ones agents ignore —
  specificity makes a rule actionable. `StuckLoopWasteLine.tool` already exists;
  this is a fixed template with one substitution slot, still static per I1.
- **A4. Filter workflow-journal noise from discovery** so `distinctSessionCount`
  and any "N recent sessions" claim is honest. Needs a crisp "real session" rule
  (min turns/tool calls/usage) with fixtures — `recentWasteAggregates()` currently
  consumes `listFullSessions()` unfiltered. *(Ground truth #6.)*
- **A5. Roll subagent waste into the parent's handoff** (child sessions/sidechains
  are cost-isolated per vendor; a handoff that ignores them under-reports loops).
  Reuse SPEC-0019/0023/0038's existing child-rollup machinery — do not invent a
  parallel chain model.

### Tier B — The resume packet: `--handoff` becomes a deterministic briefing (the headline)

Everything here is *quotation and arithmetic*, never summarization — the direct
answer to "the summary always lost my instructions."

- **B1. Session-state block (Day-1).** Open the handoff with verbatim, labeled
  anchors: session title (already parsed); last user prompt (`last-prompt`);
  TODO/task state ("3 pending, 1 in-progress: …"); in-flight interruption
  (`turn_aborted`); files touched (with a last-quartile marker); test pass/fail
  counts parsed from runner output ("30/90 passing" beats prose — blakelink.us).
  This is the manual "hand-over dance" (GitHub #54254) automated without a model
  call. **Privacy bound (Codex review):** `cwd`/`gitBranch` are attribution-only
  fields under SPEC-0019 and must NOT render in the block; file paths quoted must
  come from tool inputs the user already sees in receipts.
- **B2. Failed-approaches ledger, cost-priced (Day-1).** Detect edit→revert cycles,
  repeated failing commands, and abandoned paths deterministically; print each with
  the dollars it burned before abandonment ("approach X: 4 attempts, ≈$2.10,
  reverted"). claude-handoff's most-loved section, which nobody dollar-denominates.
  *(I2/I3: price-table math only, and — per Codex review — always labeled `≈`
  turn-share estimate: waste pricing splits a turn evenly across tool calls, and
  Codex's `apply_patch` is deliberately not decomposed per file.)*
- **B3. Compaction report.** Per compaction: trigger, pre-tokens, what survived
  (quote `preservedMessages` / `replacement_history` counts), and a **compaction-tax
  line** — tokens/`≈$` spent on re-reads in the N turns after each compaction vs.
  baseline (estimate-labeled, same bound as B2). Nobody does post-hoc
  compaction-loss accounting from the JSONL on disk.
- **B4. Rediscovery ledger.** Files Read ≥2× with no intervening Edit, priced as
  labeled estimates ("re-read src/foo.ts 4×, ≈12k tokens, ≈$0.31") + a
  cost-by-phase split (exploration / edit / verify / conversation). Targets the
  measured 40–60% redundant-read waste and the 47%-exploration finding.
- **B5. Coverage line.** The handoff states its own completeness from counts it can
  verify ("covers 14/14 file edits, 2/2 compactions, 1 interrupted turn") — a
  verifiable-fidelity claim no LLM-generated handoff can make.
- **B6. Deterministic formatting discipline.** Highest-severity item first, action
  line last (Lost-in-the-Middle U-curve), fixed line budget allocated by severity
  (LLMLingua budget-controller arithmetic) so the block stays paste-sized on any
  transcript.
- **B7. Machine-readable handoff (`--handoff --json`).** *(Converged on
  independently by the Codex review and the literature pass — Swarm's typed handoff
  object, A2A's task lifecycle, and Handoff Debt's "operational, not prose"
  standard.)* `renderHandoff()` is text-only today; expose waste bullets,
  suggestions, threshold counts, and coverage facts as versioned JSON (SPEC-0011
  schema discipline) so CI/PR/hook consumers never parse prose. Include the **full**
  per-class aggregate array, not just classes that crossed threshold — a class at
  `distinctSessionCount = 2` of 3 is today silently absent with no way to see it
  was close; exposing the existing count turns a silent miss into an inspectable
  fact (still I6-safe).

### Tier C — Rule lifecycle: standing rules that learn without a model

*(Codex review: C1/C2/C3/C6 all introduce a persistent local state file — that is a
write, and SPEC-0013 R4 draws the boundary at stdout-only/manual-paste. The whole
tier therefore requires its own spec with an explicit consent flow, mirroring
SPEC-0006 R1's confirm pattern, before any of it is built.)*

- **C1. Rule state machine.** Persist per-rule state locally:
  `detected → suggested → recurred → resolved`. Output escalates deterministically:
  "suggested 3 sessions ago — the pattern recurred twice since." *(A2A lifecycle;
  CBR Retrieve-Reuse-Revise-Retain; local file state, no network.)*
- **C2. Handoff-efficacy line (Day-1 for dogfood).** If the same waste signature
  recurs in the next session after a suggestion was shown, say so; if it stopped,
  say that. This *operationalizes SPEC-0013's open kill criterion* — adoption
  becomes measured, not anecdotal. *(The "Handoff Debt" rediscovery-cost metric.)*
- **C3. Confidence decay.** Rules not re-observed for N sessions stop rendering
  (Ebbinghaus-style arithmetic decay — self-pruning suggestion set). **Stateless
  starter variant (needs no persistent state, though as new `--handoff` output it
  is still a SPEC-0013 output-surface amendment):** a status *fact* line, not a new
  suggestion — when a class crossed threshold in the prior window but fired zero
  times recently, print "stuck-loop hasn't fired in N sessions — consider dropping
  this rule if you added it." Reuses the prior-window `aggregateWaste` call SPEC-0008
  already makes for digest deltas; I6-safe (a firing count, not a judgment).
- **C4. MDL admission filter.** Only emit a rule when its text is shorter than the
  waste log it would have prevented — an arithmetic guard against suggestion spam.
- **C5. Memory-file length guard (downgraded per Codex review).** The transcript
  carries no field proving which CLAUDE.md/AGENTS.md bytes were injected or billed,
  so a dollar figure would fabricate precision (I2/I3) — **cut the "$ tax" framing**.
  Keep the deterministic remainder: report the memory file's current line/byte
  count against a soft ceiling before suggesting more rules (bloated CLAUDE.md gets
  half-ignored — Anthropic's own guidance).
- **C6. Append-only rules store.** Delta updates only, never rewrite the store
  (ACE's anti-"context collapse" discipline made trivial: it's a file we append to).

### Tier D — Chain and fleet awareness

- **D1. Deterministic session chains.** Stitch worktree-suffix naming,
  altimate-code `parent_id`, and same-cwd/branch adjacency into an explicit chain;
  `--handoff --chain` aggregates waste across the whole task, not one session.
  *(Codex review: `fork-context-ref` is NOT a lineage signal — SPEC-0038 R4 uses it
  to cut inherited history, not preserve chains. The path/adjacency heuristics are
  weak and need explicit false-positive gates; reuse SPEC-0023's multi-session
  selection machinery rather than a parallel chain model.)*
- **D2. Concurrent-session collision flag.** Two live sessions touching overlapping
  files across worktrees → clobber-risk line (a reported fleet pain no tool covers).
- **D3. Resume-picker aid.** A `sessions` view: one deterministic line per real
  session (title · files · open TODOs · $) — the fix users asked for on
  anthropics/claude-code#46831 ("resume shows a one-word last message").
- **D4. New detectors feeding all of the above:** multi-step loop mining (AWM-style
  frequent-subsequence: read→edit→test-fail→repeat), cache-churn after compaction
  (`cacheRead` collapse = paid re-priming, Hermes-agent#480), quota burn-rate line
  (SPEC-0014 groundwork exists).

### Tier E — Distribution: meet users where the handoff happens

- **E1. Hook-native emission (Day-1).** Extend the existing consent-gated
  SessionEnd hook (SPEC-0006 owns this surface — extend it, don't duplicate it) to
  print the handoff block; a SessionStart snippet surfacing the previous block
  needs its own proven hook surface first (SPEC-0006 explicitly limits hooks to
  proven local surfaces). Every successful community tool integrates exactly here.
- **E2. `--handoff --write HANDOFF.md`** — needs its own spec + consent flow
  (SPEC-0013 R4 explicitly reserves this); the artifact convention is already
  ecosystem-standard.
- **E3. Agent-agnostic packet.** The block must paste into Codex/Cursor/opencode as
  cleanly as into Claude Code (handoff-md/claude-handoff philosophy) — plus a
  `--template` variant via SPEC-0020 machinery.
- **E4. PR-receipt integration.** A one-line handoff footer in `aireceipts pr`
  ("next contributor: this branch's sessions kept looping on X").
- **E5. Positioning.** Say the differentiator out loud in README/docs: *extraction,
  not summarization — same transcript, same handoff, byte-for-byte, no model call,
  no upload.* Contrast honestly (I6: facts, no rankings) with LLM-generated handoffs'
  documented fidelity failures.

## What we will NOT do (bounded by invariants + SPEC-0013 non-goals)

- No LLM-written prose anywhere in the block (I1) — free-text "what happened"
  narration stays out; we quote, count, and price.
- No autonomous writes to CLAUDE.md/HANDOFF.md without a new spec with a consent
  flow (SPEC-0013 R4).
- No "model X would have done better" (I6) — cheaper-model lines stay price-delta
  arithmetic.
- No network, no server rendering (I4) — the anti-Agent-Analyzer stance.

Literature ideas rejected outright (recorded so they are not re-proposed):

- **Skill/code-snippet libraries** (Voyager, AWM workflow induction, Dynamic
  Cheatsheet) — a second execution surface that replays into future sessions;
  aireceipts reads transcripts and prints facts, it never feeds an agent's context
  automatically (R4: manual paste only).
- **Vector/graph memory stores** (HippoRAG, Zep/Graphiti, MemOS) — persistent
  indexed storage and, for real retrieval, embeddings: a model call and infra I1/I4
  rule out.
- **Reflexion/ExpeL/Self-Refine-style model-generated reflections** — free-text
  generation is exactly what SPEC-0013 R2 bans; only their *loop structures*
  translate (and are used above).
- **Cross-model/agent competence ranking** — I6, categorically.
- **Full repo-state resumability snapshots** (Handoff Debt's maximal version:
  working tree, open cursors, uncommitted diffs) — requires reading the working
  tree, which no aireceipts feature does today; a future spec must argue that
  boundary explicitly rather than sliding into it via `--handoff`.

## Suggested build order (revised after Codex review)

1. **A1** (Codex compaction parsing, with sanitized fixtures + new `Compaction`
   fields) and **A4** (real-session discovery filter) → truth fixes that unblock
   everything.
2. **A2** — commit the real-session corpus as fixtures FIRST (SPEC-0017 demands
   zero-false-positive justification), then retune; **A3** rides as a SPEC-0013
   template amendment with evidence.
3. **B1-lite + B5 + B7** (state block + coverage line + JSON surface). B1-lite
   means only fields `Session`/`ReceiptModel` already carry (title, duration,
   model mix, totals, counts, compactions) — B1's verbatim anchors (last prompt,
   TODO state, `turn_aborted`, files touched, test counts) are NOT normalized
   today and need their own adapter/privacy spec. Drafted as SPEC-0042.
4. **B2/B3/B4** (priced ledgers) once the `≈` estimate-labeling story is settled —
   the attribution math must be defensible before dollars print.
5. **C-tier** as its own consent-flow spec (state file = a write under R4);
   C2's efficacy line is the piece that answers SPEC-0013's kill criterion with
   data.
6. **E1** (extend SPEC-0006's hook), then **D-tier** once the packet proves
   adoption.

## Review record

**2026-07-04 · Codex (read-only, staff-engineer critique): 15 findings, all
incorporated above** — privacy bound on B1 (cwd/branch never render); C-tier
requires a consent-flow spec (state file = write under SPEC-0013 R4); C5's dollar
framing cut (unprovable injection → I2/I3); B2–B4 must carry `≈` turn-share
labels; A1 scoped as model+adapter change; `ai-title` claim corrected; D1's
`fork-context-ref` overclaim fixed; A2 gated on committed corpus; A5/D1/E4 reuse
SPEC-0019/0023/0038 machinery; E1 extends SPEC-0006; **B7 (`--handoff --json`)
added at Codex's suggestion**. Market claims below are positioning context, not
spec-input requirements — pin dated citations before quoting externally.

## Source appendix (key references)

- Amp handoff: https://ampcode.com/news/handoff · https://tessl.io/blog/amp-retires-compaction-for-a-cleaner-handoff-in-the-coding-agent-context-race/
- Anthropic "not planned" issues: anthropics/claude-code #44200, #18550; resume-summary ask #46831; handoff verbs #11455; native /handover #54254
- Competitors/prior art: analyzer.spec-kitty.ai · github.com/chrishutchinson/claude-receipts · github.com/willseltzer/claude-handoff · github.com/guvencem/handoff-md · github.com/thedotmack/claude-mem · ccusage.com · github.com/getagentseal/codeburn · github.com/jazzyalex/agent-sessions · github.com/riponcm/projectmem
- Research: "Handoff Debt" (arXiv 2026) · CWL "Beyond Compaction" (arXiv:2606.11213) · AgentDiet · AWM (arXiv:2409.07429) · ExpeL (AAAI 2024) · Reflexion (NeurIPS 2023) · MAST (arXiv:2503.13657) · Context Rot (Chroma, 2025) · "How Coding Agents Fail Their Users" (arXiv:2605.29442) · PROJECTMEM (arXiv:2606.12329) · Gloaguen et al. via iwoszapar.com/p/context-engineering-research-2026
- Codex compaction gap + trace facts: local trace analysis 2026-07-04 (~/.claude/projects, ~/.codex/sessions, ~/.local/share/altimate-code)
