---
id: SPEC-0023
title: "aireceipts pr — sum every session behind a PR, not just one"
status: approved
milestone: M3
depends: [SPEC-0019]
---

# SPEC-0023 · multi-session PR cost

Invariants: I1 (deterministic selection + render), I2/I3 (never fabricate a
dollar; mixed priced/tokens-only totals stay separate, never blended — SPEC-0008's
honesty pattern), I6 (facts, not rankings — role labels describe structure, they
never rank a session as better/worse).

## Purpose

SPEC-0019 attaches ONE session's receipt to a PR — but a real PR is built by
several sessions at once: a lead/orchestrator, one or more builders (often
separate teammate sessions, not on-disk subagents), and sometimes a Codex
helper. The maintainer, reviewing the first product-posted receipts, said it
plainly: *"all of them are getting used, I don't see it in the receipts."* This
is the follow-up SPEC-0019 named in its own non-goals ("multi-session PR
totals — a future spec once attribution is proven"). It reuses SPEC-0019's proven
machinery (`src/pr/{slice,select,rollup,gitWrite}`) unchanged and adds one thing:
select **all** contributing sessions instead of erroring on the second, and sum
them into one PR cost with honest per-session rows. It also folds in issue #39's
two comment fixes (honest scope header, demoted slice line).

**Kill criterion:** if any session is attributed to a PR it did not contribute to
in dogfood (a false-positive row), the auto-selection narrows — the
weakest signal (Codex matched on cwd+time) is cut further, ultimately to require a
branch-SHA anchor like Claude, and the change ships behind an explicit `--session`
list. *(Fired once already — see Validation: the first cut credited SHA-less Codex
sessions from sibling worktrees; the cwd+time rule was scoped to the current
worktree.)*

## Requirements

- **R1 — Contributor set (replaces SPEC-0019's one/many/none auto-select).**
  `aireceipts pr` (no `--session`) selects every session that contributed to the
  current branch, conservatively. A *candidate* is a non-sidechain session whose
  `cwd` is inside a repo worktree root (R1b of SPEC-0019, reused) and whose time
  window overlaps a branch commit (R1d, reused) — the cheap summary-level filter.
  Each candidate is then loaded and classified by its branch-SHA anchors
  (`classifyBranchAnchors`, a named extension of `src/pr/slice.ts`'s existing
  anchor logic — own = a hex run in a git-write span's OUTPUT prefix-matches a
  branch SHA; foreign = a git-write span with only non-branch SHAs):
  - a **Claude** candidate contributes iff it has an own anchor (it emitted a
    branch commit/push SHA — the lead/orchestrator/builder slice); a branch-SHA
    anchor credits a session regardless of which worktree it ran in (SHA proof
    can't false-match across branches);
  - a **Codex** candidate contributes iff it has an own anchor OR it made no git
    writes **at all** AND ran in the **current** worktree (`git rev-parse
    --show-toplevel`) — a pure helper/reviewer matched on cwd+time, Codex's
    softer rule since Codex often assists without committing. The current-worktree
    scope is load-bearing: `git worktree list` returns *every* worktree of the
    repo, and unrelated Codex sessions run concurrently in sibling worktrees on
    other branches — a SHA-less helper is only credited when it ran here;
  - any candidate that committed/pushed but produced no branch SHA (**foreign-only**,
    or a no-op/failed write with no SHA in its output) is excluded — not proven ours.
  Empty contributor set → the SPEC-0019 message + exit 1. A candidate that is
  excluded but plausibly ours (in the **current** worktree, unproven) is counted
  for the R4 "not attributed" note; a SHA-less sibling-worktree candidate (another
  branch's work) is silently ignored, not reported as noise.
- **R2 — Per-contributor rendering (reuses R1e/R1c per session).** Each
  contributor is sliced to its own PR turn range (`computeSlice` +
  `sliceSessionForReceipt`, unchanged) and its in-window subagent children are
  rolled up (`rollupChildren`, unchanged). A contributor is priced or tokens-only
  exactly as its own receipt would be (I2). Nothing about SPEC-0019's slicing,
  anchor, or rollup rules changes — R1 only widens selection from one session to
  the set.
- **R3 — Role label (descriptive, deterministic, non-ranking).** Each contributor
  carries a role derived from observable structure, not judgement:
  `codex` (source is Codex); `orchestrator` (a Claude session that spawned
  subagents — has on-disk children — or issued a `Task`/`Agent` tool call or
  launched `codex exec`); `builder` (any other contributing Claude session). The
  label describes what the session *did structurally*; it is not a quality
  ranking (I6).
- **R4 — Comment body: rows + one combined total + #39 fixes.** The body is the
  SPEC-0019 marker (`<!-- aireceipts-dogfood -->`, unchanged, so R5's presence
  check and the R2-upsert still find it) and 🧾 header, then one fenced block:
  - **Header (#39 fix 1):** `N sessions behind this PR` — never "1 of the
    sessions" / never implying one transcript is the whole story.
  - **Per-session row:** `<role> · <model-mix> · <cost-or-tokens>`, where model-mix
    shows each model with its rounded token share (`claude-opus-4-8 100%`; multi:
    `… 80% · … 20%`). Under each row, a **muted provenance line (#39 fix 2):** the
    session id + its slice header (`turns A–B of N`) or the full-session fallback
    label — moved OUT of the headline into provenance. A contributor's subagent
    children render as indented sub-rows beneath it (name · model · cost, or
    `(unreadable)`), reusing SPEC-0019's `SubagentRow`.
  - **One combined total:** the sum across every contributor slice + every rolled-up
    child. Priced atoms sum to a `$` subtotal; tokens-only atoms sum to a separate
    token subtotal; the two are **never blended** (I2/I3 — SPEC-0008's pattern):
    all-priced → `$X`; all-unpriced → `T tokens`; mixed →
    `$X priced + T tokens (M sessions tokens-only)`.
  - **Honest exclusion note:** when candidates were excluded (R1), a final line
    reports `K candidate session(s) not attributed (in repo + branch window, no
    branch commit)` — plausible-but-unproven sessions are surfaced, never hidden.
- **R5 — `--session <id>` still selects exactly one.** The explicit path
  (`selectExplicitSession`, unchanged, incl. subagent-by-stem) renders that single
  session as a one-contributor body — the multi-session renderer degenerates
  cleanly to N=1. R3's render-first ordering and R2's gh upsert (SPEC-0019)
  are untouched: the full body is always written to stdout before any `gh` call.
- **R6 — Codex cwd/output parity (prerequisite — verified present).** R1's Codex
  rule needs the Codex adapter to retain `cwd` (attribution-only) and tool OUTPUT
  text for git-write spans. Both are already retained (`src/parse/codex.ts`:
  first-seen `cwd`; `function_call_output`/`patch_apply_end` output captured) —
  confirmed, so no adapter change is needed (unlike SPEC-0019's R1a, which had to
  add `cwd`). A fixture proves a Codex session with a branch-SHA commit output is
  classified own-anchor.

## Scenarios

- **Given** two Claude sessions that each committed a SHA on this branch, **when**
  `aireceipts pr` runs, **then** both are contributors (no "multiple — pick one"
  error) and the total sums both slices.
- **Given** a Claude builder plus a Codex helper (in repo + window, no commit),
  **when** `aireceipts pr` runs, **then** both render as rows and the Codex row is
  included on the cwd+time rule.
- **Given** a Codex session whose only commit output SHA is NOT on this branch,
  **when** `aireceipts pr` runs, **then** it is excluded and counted in the "not
  attributed" note.
- **Given** a priced Claude contributor and a tokens-only contributor, **when** the
  combined total renders, **then** the `$` subtotal and the token subtotal are
  shown separately, never summed into one number.
- **Given** `--session <id>`, **when** `aireceipts pr` runs, **then** exactly that
  session renders as a single-contributor body.
- **Given** one contributor with two in-window subagents, **then** the row shows
  both sub-rows and the combined total includes them (SPEC-0019 rollup, unchanged).

## Non-goals

- **Changing SPEC-0019's slice/anchor/rollup algorithms.** R1 only widens
  selection; the per-session machinery is reused byte-for-byte.
- **Ranking or grading sessions** (I6). Role labels describe structure only.
- **Cross-repo / non-GitHub forges** (SPEC-0019 non-goal, still out).
- **Attributing a session with no branch-SHA proof and no cwd+time signal.** If a
  contributor can't be proven, it is excluded and noted, never guessed in.
- **A per-tool breakdown per session in the comment.** The comment is a rollup of
  rows + one total; `aireceipts receipt --session <id>` remains the full per-tool
  audit for any one session.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 union | two Claude sessions, each own-anchored to the branch | both contribute; total sums both |
| R1 claude no-anchor | Claude in repo+window, no branch SHA in output | excluded; counted in note |
| R1 codex helper | Codex in THIS worktree+window, no git writes | contributes (cwd+time) |
| R1 codex sibling | SHA-less Codex helper in a sibling worktree | ignored (not credited, not counted) |
| R1 sibling own-anchor | branch-SHA session in a sibling worktree | contributes (SHA proof beats scope) |
| R1 codex own-anchor | Codex with branch-SHA commit output | contributes (own) |
| R1 foreign-only | session whose only commit SHA is off-branch | excluded; counted in note |
| R1 no-SHA git write | Codex `git commit` with no SHA in output | excluded (a git write, not a helper) |
| R1 empty set | no candidate has cwd+time+proof | SPEC-0019 message + exit 1 |
| R1 sidechain excluded | only a subagent transcript is a candidate | not a top-level contributor |
| R2 per-session slice | contributor with 2-branch anchors | sliced to its own turn range |
| R2 rollup | contributor with 2 in-window children | children summed into total |
| R3 roles | codex / has-children / plain claude | codex / orchestrator / builder |
| R3 orchestrator-by-task | Claude with a `Task` tool call, no disk children | orchestrator |
| R4 header | N contributors | header reads `N sessions behind this PR` |
| R4 provenance | any contributor | slice line is a muted line under the row, not the headline |
| R4 combined all-priced | every atom priced | one `$` total, no token line |
| R4 combined mixed | priced Claude + tokens-only Codex | `$X priced + T tokens (M tokens-only)`, never blended |
| R4 combined all-tokens | no atom priced | `T tokens`, zero `$` bytes |
| R4 not-attributed note | ≥1 excluded candidate | `K … not attributed …` line present |
| R4 marker | rendered body | starts with `<!-- aireceipts-dogfood -->`, fenced |
| R5 explicit one | `--session <id>` | single-contributor body |
| R5 render-first | gh missing / post fails (mock) | stdout body FIRST, stderr diagnostic, exit 1 (SPEC-0019) |
| R6 codex parity | codex fixture w/ branch-SHA commit output | classified own-anchor |
| R6 codex cwd | codex fixture w/ cwd | cwd on the model (already retained) |

## Success criteria

- [ ] This spec's own PR carries a **multi-session** receipt posted by the feature
      itself — a body listing more than one contributing session, including the
      builder session that wrote this code, with one combined total.
- [ ] Conservative selection holds in dogfood: no session appears that did not
      commit to this branch (kill criterion not triggered).
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, `node scripts/spec-lint.mjs` all pass
      unmasked (`echo $?`); goldens untouched (the PR comment body is not
      golden-gated).

## Validation

**2026-07-02 · basis:** direct maintainer request — *"all of them are getting
used, I don't see it in the receipts."* Scope confirmed against SPEC-0019's named
non-goal and issue #39's designated follow-up. The prerequisite that killed
SPEC-0019's first pass (Codex adapter dropping `cwd`) is already resolved here —
`cwd` and tool output are retained (R6), so this spec adds no adapter change,
only wider selection + a rollup renderer. Kill criterion set to the honesty
failure the maintainer most fears: a session credited with a PR it never touched.

**2026-07-02 · dogfood (kill criterion fired, narrowed):** the first cut ran
`node dist/cli.js pr` on this PR's own worktree and credited **7 Codex sessions**,
several of which predated the worktree's creation — i.e. unrelated Codex work in
*sibling* worktrees, since `git worktree list` returns every worktree of the repo
and the SHA-less cwd+time Codex rule matched them all. Two fixes landed: (1) the
SHA-less Codex helper rule is scoped to the **current** worktree
(`git rev-parse --show-toplevel`) — a branch-SHA anchor still credits any worktree
(SHA proof), but a helper with no commit is only credited when it ran here; (2)
the "not attributed" note counts only *plausible* (this-worktree) exclusions, so
sibling-worktree candidates are silently ignored rather than reported as noise.
A separate codex-review finding (SHA-less git writes miscounted as "no writes")
was fixed the same round via output-independent `writeCount`.
