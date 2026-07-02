---
id: SPEC-0016
title: "Repo hygiene gates — agent-grounding cleanliness, enforced in CI"
status: draft
milestone: M2
depends: [SPEC-0001]
---

# SPEC-0016 · Repo hygiene gates

Invariants: I1 (all checks deterministic, local-runnable), I3 (every gate's claim must
be true — this spec exists partly because AGENTS.md claims a CI-enforced line budget
that no CI job enforces today).

## Purpose

An agent-maintained repo degrades in specific ways: context files bloat, scratch files
accumulate at the root and pollute agent grounding, workflow YAML breaks silently,
squash-commit messages (= PR titles, per the squash-only rule) drift from convention,
and secrets slip into history right before an OSS flip. Each gets a mechanical gate —
runnable locally with one script, enforced in CI. Scope is strictly what an
agent-developed repo needs; no generic linter zoo. **Kill criterion:** any gate that
false-positives twice in a month gets fixed or deleted — a hygiene gate agents route
around is worse than none.

## Requirements

- **R1 — Constitution budget gate.** CI fails if `AGENTS.md` exceeds 150 lines (closing
  the existing unenforced claim) or if `CLAUDE.md` exceeds 3 lines (it must stay a
  pointer). Message names the file, the count, and the rule's rationale (bloat
  measurably degrades agent performance).
- **R2 — Root-clutter gate.** The repo root is allowlisted (config files, standard
  docs, the known directories). An unexpected top-level entry fails CI with "agents
  treat root files as authoritative — move it to scratch, docs/, or delete it" (the
  ancestor-repo anti-pattern: stray M-notes and debug scripts at root mislead every
  future agent session).
- **R3 — PR-title lint.** Squash-only merging makes the PR title the permanent commit
  subject. A `pull_request`-triggered check enforces conventional-commit shape
  (`type(scope)?: subject`, type ∈ feat|fix|docs|chore|test|refactor|ci|perf, subject
  ≤ 72 chars) — with the same voice rule as commits (no internal-process framing).
- **R4 — Determinism gate in CI.** `scripts/determinism-check.mjs` (exists, currently
  local-only) runs in the CI verify job: goldens ×10 under the frozen env. Byte drift
  between runs fails the build — nondeterminism is a product bug here, not flake.
- **R5 — Workflow lint.** `actionlint` (pinned version) validates `.github/workflows/*`
  on any PR touching them — agents edit workflows and YAML fails silently otherwise.
- **R6 — Secret scan.** `gitleaks` (pinned) scans the diff on every PR and full history
  on a manual dispatch (the pre-OSS-flip button). Any finding is a blocking failure.
- **R7 — One local entrypoint.** `node scripts/hygiene.mjs` runs R1+R2 (+R3's title
  regex given an argument) locally so agents self-check before pushing; CI and the
  script share the same rules (single source — no CI-vs-local drift).

## Scenarios

- **Given** AGENTS.md at 151 lines, **when** CI runs, **then** the verify job fails
  naming the budget rule.
- **Given** a stray `debug-notes.md` at repo root, **when** CI runs, **then** R2 fails
  with the move-or-delete message.
- **Given** a PR titled "updates", **when** the title check runs, **then** it fails
  with the expected shape and an example.
- **Given** a renderer made time-dependent, **when** R4 runs goldens ×10, **then** the
  byte drift fails CI even though a single golden pass succeeded.
- **Given** a workflow edit with a wrong `needs:` key, **when** R5 runs, **then**
  actionlint fails the PR.

## Non-goals

Generic style linters beyond the existing eslint config; commit-by-commit message
linting (squash-only makes PR titles the only durable subjects); enforcing branch
protection (a maintainer settings action, documented not coded); CODEOWNERS (single
maintainer); license/header scanners.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 over budget | fixture AGENTS.md 151 lines (script unit test) | exit 1, names file+count |
| R1 pointer file | CLAUDE.md 4 lines | exit 1 |
| R2 clutter | temp stray root file | exit 1, move-or-delete message |
| R2 allowlist | current clean root | exit 0 |
| R3 title shapes | "updates" / "feat: x"×80chars / "feat: ok" | fail / fail / pass |
| R4 determinism | goldens ×10 frozen env | exit 0 today; drift-injection unit test exits 1 |
| R5 workflow lint | valid + broken workflow fixture | pass / fail |
| R6 secret scan | leaked-key fixture in a test branch diff | blocking failure |
| R7 parity | hygiene.mjs vs CI job rules | same allowlist/budget constants (one module) |

## Success criteria

- [ ] All gates green on the current repo as-is (proving current cleanliness), and each
      gate demonstrated failing on its fixture in tests.
- [ ] Unmasked gate + spec-lint green; hygiene checks added to AGENTS.md's verification
      block without exceeding its own budget (the recursion is the point).

## Validation

*(pending /validate-spec)*
