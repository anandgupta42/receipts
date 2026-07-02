---
id: SPEC-0019
title: "aireceipts pr — attach the building session's receipt to the current PR"
status: draft
milestone: M3
depends: [SPEC-0001]
---

# SPEC-0019 · `aireceipts pr`

Invariants: I1 (deterministic selection + render; the only side effect is an explicit,
user-invoked `gh` call), I2/I6 as always on the rendered receipt.

## Purpose

"Every PR carries the receipt of the session that built it" is currently a manual
lead habit — and it visibly fails (PRs #19–#21 shipped receiptless until the
maintainer asked). It cannot be a plain CI job: transcripts live on the developer's
machine, never on the runner. So the correct architecture is **local generation +
CI presence-verification**: a one-command local step wired into the build procedure,
and a soft CI check that notices when it was skipped. This is also a real *product*
feature — any developer can attach their agent-session receipt to any repo's PR.
**Kill criterion:** if session→PR attribution mislabels a receipt in dogfood even once
(wrong session posted), the auto-selection is cut back to explicit `--session <id>`
only.

## Requirements

- **R1a — Parse-model extension (prerequisite).** Adapters currently DROP the raw
  `cwd` — extend the parse model with `cwd?: string` and `gitBranch?: string`
  (claude-code + codex extraction, fixture rows for both; absent in the raw → absent
  in the model). Sessions without `cwd` are never auto-attributed. **Privacy rule:**
  `cwd`/`gitBranch` are attribution-only — they never enter export schemas (--json/--csv),
  rendered receipts, or telemetry; the strict-schema parity tests assert their absence.
- **R1b — Repo identity.** The reference is the *worktree root of the current
  process*; sibling worktrees of the same repo (the dogfood shape:
  `../aireceipts-specNNNN`) are included via `git worktree list --porcelain`
  common-dir matching. A session's `cwd` must be at/inside one of those roots.
- **R1c — Top-level sessions only.** Subagent/sidechain transcripts are excluded from
  auto-selection; if only sidechains match, the command lists them and requires
  `--session <id>`.
- **R1d — Time overlap (exact).** Session window = `[startedAtMs, lastEventAtMs]`
  (either missing → excluded from auto-selection). Branch window = committer dates of
  `git log $(git merge-base <default> HEAD)..HEAD`, ±15 min slack, inclusive. Overlap
  = any commit instant inside the padded session window. Zero matches → message +
  exit 1; multiple → list + require `--session` (never guess).
- **R2 — Post via gh (concrete upsert sequence).** `aireceipts pr --post`: (1) resolve
  the PR via `gh pr view --json number`; (2) list issue comments via `gh api`; (3) find
  the comment whose body starts with marker `<!-- aireceipts-dogfood -->`; (4) PATCH it
  by id (`gh api …/issues/comments/{id} -X PATCH`) or create if absent. One receipt
  comment per PR, always current — `gh pr comment --edit-last` is NOT used (wrong
  comment risk). Body: marker line + 🧾 header naming the session id + code-fenced
  receipt. Without `--post`: dry-run, prints the exact body.
- **R3 — Render-first, fail-visible.** The full pasteable body is ALWAYS written to
  stdout before any `gh` call; missing `gh`/not-a-PR/network failure then adds a
  one-line stderr diagnostic and exits 1. Rendering and posting are strictly ordered —
  a failed post can never eat the receipt.
- **R4 — Harness wiring.** build-spec step 7 gains: run `aireceipts pr --post` before
  handing the PR over (agents run it from their worktree). The PR template's Evidence
  section mentions the receipt comment.
- **R5 — CI presence check (soft, testable).** The logic lives in
  `scripts/check-pr-receipt.mjs` (input: a comments-JSON file; output: found/missing) —
  unit-tested with fixtures; the workflow is a thin caller feeding it
  `gh api` output and emitting a neutral `::notice` when missing (never a failure —
  external contributors have no sessions and must not be blocked).

## Scenarios

- **Given** one matching session, **when** `aireceipts pr --post` runs on a PR branch,
  **then** exactly one marked comment exists on the PR carrying that session's receipt.
- **Given** two matching sessions, **when** `aireceipts pr` runs, **then** it lists
  both ids and exits 1 without posting.
- **Given** a second `--post` after more commits, **then** the marked comment is
  edited in place (no comment spam).
- **Given** no `gh` binary, **then** the receipt prints to stdout with a paste hint.

## Non-goals

Running generation in CI (transcripts aren't there); per-push cost ledgers and
multi-session PR totals (a future spec once attribution is proven); posting to
non-GitHub forges.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1a cwd parsing | claude-code + codex fixtures w/ raw cwd | cwd/gitBranch on model; absent stays absent |
| R1b worktree cwd | session cwd = sibling worktree path | matched via common-dir |
| R1c sidechain | only a subagent transcript matches | listed, --session required, exit 1 |
| R1d overlap math | boundary commit at window edge ±slack | inclusive per spec |
| R1d missing timestamps | session w/o startedAt | excluded from auto-selection |
| R1 multi match | two overlapping sessions | list + exit 1, no post |
| R1 zero match | no cwd-matching session | message + exit 1 |
| R2 upsert | post twice (mocked gh api) | PATCH by id, not append; --edit-last never invoked |
| R2 marker | posted body | starts with `<!-- aireceipts-dogfood -->`, fenced receipt |
| R3 ordering | gh missing / post fails (mock) | stdout body FIRST, stderr diagnostic, exit 1 |
| R3 not-a-PR | branch without PR | stdout body + hint, exit 1 |
| R5 script | comments-JSON fixtures (present/absent) | found/missing verdicts; workflow thin-caller |
| R4 wiring | build-spec skill + PR template diff | step + Evidence mention present |

## Success criteria

- [ ] This spec's own PR carries a receipt posted by the feature itself (the loop
      closes: the tool attaches the receipt of the session that built the
      receipt-attacher).
- [ ] Unmasked gate + spec-lint green; goldens untouched.

## Validation

**2026-07-02 · S2 (Codex): REWORK → reworked same day, all 8 applied.** Blockers: the
parse model carried no `cwd` (adapters drop it) → R1a extension requirement added;
worktree-sibling cwd shape (the actual dogfood) would have been rejected → R1b
common-dir identity. Also: sidechain exclusion (R1c), exact overlap arithmetic w/
missing-timestamp exclusion (R1d), concrete gh-api upsert sequence replacing the
infeasible `gh pr comment` edit (R2), render-first ordering (R3), R5 logic moved to a
fixture-testable script, matrix expanded to 13 rows. **S4:** spec-lint green.
