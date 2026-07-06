---
id: SPEC-0045
title: "Discovery-layer load failures — the session that never became a candidate"
status: shipped
milestone: M4
depends: [SPEC-0044]
---

# SPEC-0045 · discovery-layer load failures

Invariants: I2 (never silently under-report), I3 (traceable + uncertainty
stated). The deferred follow-up from SPEC-0044 B4's review: B4 closed the
*selection*-layer silent drop (a candidate whose `loadSession` returns null now
emits `unreadable-session`), but a session that fails at the *discovery* layer —
before it ever becomes a candidate — is still dropped with no signal.

## Purpose

`src/pr/index.ts` filters `listFullSessions()` summaries into candidates, then
`loadSession`s each; B4 flags a `loadSession` null. Two discovery-layer drops
happen *upstream*, so the session never reaches the candidate filter:

- **Sub-case 1 — full-completion failure, metadata survives.** A lazy summary is
  built (`filePath`, `source`, `startedAt` from first record, `endedAt` from
  mtime, and — for Claude/Codex/Gemini — a first-record `cwd`), but
  `completeSummariesWithCache` fails to complete it and drops it
  (`summaryCache.ts:207` `results.filter((s) => s !== null)`).
- **Sub-case 2 — lazy-summary failure, no metadata.** The adapter's own
  `listSessions` catch (`claudeCode.ts:416/432`) drops a file that can't produce
  even a lazy summary — no `cwd`/timestamps, so PR-relevance is unknowable.

**S2 killed the naive "reuse B4 for free" premise; the corrected design:** a
degraded summary does NOT automatically hit B4's emission. `selectContributors`
routes a load-null `here` (current-worktree) candidate to `silenced-git-write`,
not `unreadable-session` (`contributors.ts:165` vs `:173`), and the anchor pool
admits a no-cwd file on time-overlap alone — which would *wallpaper*. So R1 adds
explicit PR-layer routing keyed on a degraded **reason**, and scopes strictly to
repo-cwd relevance. Sub-case 2 (no metadata → unscopeable) is documented, not
surfaced (the A3 crying-wolf lesson).

**Organizing principle (unchanged from SPEC-0044):** a session that touched a PR
is credited, or its absence is *visibly* flagged — extended up to discovery,
honestly: scoped where cwd lets us scope, documented where we structurally
cannot.

**Kill criterion:** (a) the `unreadable-session` signal fires ONLY for a
degraded file whose `cwd` places it in THIS repo/worktree — never on
time-overlap alone (no wallpaper; verified by a degraded no-cwd + in-window
fixture that must NOT fire). (b) No non-PR surface (`week`, `compare`, token
budget, `--list`/`--json`, the default receipt) renders a degraded summary's
incomplete/zero total. If (a) can't be met because the degraded summary lacks a
reliable `cwd`, that file is unscopeable and falls to R3 (docs), not a fired
event.

## Requirements

- **R1 — Retain degraded summaries with a typed reason.** When
  `completeSummariesWithCache` fails to complete a lazy summary *because the
  transcript's own parse failed* (not a transient stat/size/cache miss — those
  are retried, never marked degraded), mark it `degraded: "unreadable"` (a field on
  `SessionSummary`, cited in `parse/types.ts`, not inlined) and RETAIN it. The
  distinction matters: only a deterministic parse failure guarantees the PR-side
  `loadSession` will also return null (S2 finding 4).
- **R2 — PR-layer routing: degraded + repo-scoped → `unreadable-session`.** In
  `selectContributors`, a candidate whose summary is `degraded: "unreadable"` AND
  whose `cwd` resolves into the current repo/worktree emits `unreadable-session`
  (SPEC-0044 B4's variant) and floors `≥` — routed explicitly, NOT into the
  `here`→`silenced-git-write` path (S2 finding 1). A degraded candidate with NO
  `cwd`, or a `cwd` outside this repo, is NOT admitted on time-overlap alone and
  does NOT fire (S2 finding 2 — the anti-wallpaper guard); it is unscopeable →
  R4.
- **R3 — Non-PR surfaces exclude degraded summaries (ALL of them).** Every
  non-PR consumer that reads a summary's totals filters out `degraded`
  summaries: `week` (`aggregate/week.ts`), `compare`, token budget
  (`budget/compute.ts`), `--list` + its `--json` (`cli/commands/list.ts`,
  `receipt/json.ts`). The default receipt uses `newestSession()` (lazy, a
  different path — S2 finding 5): if the newest is `degraded: "unreadable"`, skip to
  the next readable session rather than render a zero receipt. A test pins each
  surface (S2 finding 6).
- **R4 — Sub-case 2 + unscopeable sub-case-1 are documented, not surfaced.** A
  file that fails lazy-summary building, or a degraded file with no usable
  `cwd`, cannot be scoped to a PR; `docs/trust.md` gains a "discovery-layer
  limitation" entry stating these are excluded and why. No per-receipt caveat
  (unscoped → wallpaper). (R3-telemetry from the prior draft is CUT per S2
  finding 7 — it added plumbing for no user-visible scoped signal.)
- **R5 — Discovery stays isolated + deterministic.** Retaining degraded
  summaries never reorders complete summaries, never aborts the list on one bad
  file (existing per-adapter isolation holds), and is deterministic (same
  corrupt fixture → same degraded entry, verified ×10).

## Scenarios

- **Given** a transcript whose `cwd` is in THIS repo and whose lazy summary
  builds but parse fails, **when** the PR receipt renders, **then**
  `unreadable-session` fires and the total floors `≥` (R2).
- **Given** a degraded file with no `cwd` (or a `cwd` in another repo) that
  merely overlaps the branch window, **then** NO event fires — not wallpaper
  (R2 anti-wallpaper).
- **Given** a degraded summary exists, **when** `week`/`compare`/budget/`--list`
  run, **then** it is excluded; no incomplete/zero total renders (R3).
- **Given** the newest session is degraded, **when** the default receipt runs,
  **then** it falls through to the next readable session (R3).
- **Given** a file that fails lazy-summary building, **then** nothing renders and
  `trust.md` documents the exclusion (R4).

## Non-goals

- **Recovering an unreadable transcript's cost** — no parseable tokens; make the
  ABSENCE visible, never fabricate a `$`.
- **Scoping sub-case 2 or a no-cwd degraded file** — structurally impossible; R4
  documents it.
- **A per-receipt global unreadable-file count** — rejected as wallpaper.
- **Discovery-to-telemetry plumbing for sub-case 2** — cut (S2 finding 7).
- **Changing B4's existing selection emission** — R2 adds a sibling route.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 degraded flag | lazy-ok + parse-fails file | summary retained, `degraded: "unreadable"`; a transient stat/cache miss is NOT marked degraded |
| R2 scoped emit (here) | degraded file, `cwd` in current worktree | `unreadable-session` fires (NOT `silenced-git-write`), total floors `≥` |
| R2 scoped emit (anchor-pool) | degraded file, `cwd` in repo, cross-worktree | `unreadable-session` fires |
| R2 anti-wallpaper | degraded file, no `cwd`, in branch window | NO event, NO floor |
| R2 outside repo | degraded file, `cwd` in another repo | NO event |
| R3 week/compare | a degraded summary present | excluded; no incomplete total |
| R3 budget + `--list`/`--json` | a degraded summary present | excluded from totals/rows/JSON |
| R3 default receipt | newest session is degraded | falls through to next readable |
| R4 sub-case 2 | file fails lazy-summary build | nothing rendered; documented |
| R5 determinism | same corrupt fixture ×10 | identical degraded entry, stable order |

## Success criteria

- [x] A repo-scoped degraded session flags `unreadable-session`; a no-cwd /
      out-of-repo degraded file does NOT (red-then-green, both directions).
- [x] `week`/`compare`/budget/`--list`/`--json`/default-receipt never render a
      degraded summary's total (a test per surface).
- [x] Sub-case 2 + unscopeable degraded are docs-only; no receipt caveat.
- [x] `docs/trust.md` gains the discovery-layer limitation entry.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` pass unmasked; the
      `src/pr/**` + `src/pricing/**` mutation gate (SPEC-0044 M3) holds.

## Validation

**2026-07-05 · S1 (self):** grounded the two sub-cases in `summaryCache.ts:207`
and the adapter catches; the initial "reuse B4 for free" framing was the risk.

**2026-07-05 · S2 (Codex, read-only): REWORK → reworked.** 7 findings, all
accepted:
1. CRITICAL — degraded `here` candidate routes to `silenced-git-write`, not
   `unreadable-session` → R2 now adds explicit PR-layer routing keyed on the
   degraded reason, bypassing the `here` path.
2. HIGH — no-cwd degraded fires on time-overlap alone (wallpaper) → R2
   anti-wallpaper guard: fire only when `cwd` is repo-scoped; else → R4.
3. HIGH — R3 non-PR caller list incomplete → added budget, `--list`/`--json`.
4. MEDIUM — `loadSession`-null not guaranteed → R1 marks degraded ONLY on a
   deterministic parse failure (`degraded: "unreadable"`), not transient stat/cache.
5. MEDIUM — default receipt uses `newestSession` (lazy) → R3 handles that path
   explicitly (fall through to next readable).
6. Missing test rows → added (here/anchor-pool/no-cwd/outside-repo/budget/list/
   default/transient-vs-parse).
7. Cut R3-telemetry (weakest) → sub-case 2 is docs-only (R4).

**2026-07-05 · S3 (value gate):** the evidence is B4's own review — this exact
gap was found one layer down while fixing B4, on this repo. The red-then-green
(a repo-scoped degraded fixture fires; a no-cwd one does not) is runnable the
day R1/R2 land.

**2026-07-05 · S4 (lint):** `node scripts/spec-lint.mjs` → OK.

Status remains draft pending maintainer approval (button 1).

**2026-07-05 · approved (button 1):** maintainer, in-session ("lets do" + Option
A repo-cwd-scoped). Status → building.

**2026-07-05 · implementation review (Codex): REWORK → all addressed.**
1. HIGH — `load()→null` also covers missing/raced/IO files, so `degraded:"parse"`
   mislabels → renamed the reason to cause-agnostic `degraded:"unreadable"` (the
   user-facing signal — "couldn't read a session" — is honest for all of them);
   only a load-null after a *successful* stat sets it (a transient stat throw
   stays a dropped null, never degraded).
2. HIGH — the no-selector default receipt used lazy `newestSession` and errored
   on a corrupt newest → `resolveSelector` now iterates lazy summaries and
   returns the newest that LOADS (carrying the pre-loaded session so `receipt.ts`
   doesn't re-parse — same load count in the common case), skipping an
   unreadable newest.
3. MEDIUM — anti-wallpaper admission was under-tested → added a runPr test: a
   degraded no-cwd session that only overlaps the window does NOT fire
   `unreadable-session` (kills the `if (s.degraded) continue` mutant).
4. LOW — confirmed the R2 contributor test kills the routing mutant (degraded →
   `unreadable-session` vs → `excludeHere`).
5. LOW — no golden risk (additive field; default `listFullSessions` filters
   degraded).
