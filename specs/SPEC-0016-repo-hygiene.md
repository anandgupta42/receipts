---
id: SPEC-0016
title: "Repo hygiene gates — agent-grounding cleanliness, enforced in CI"
status: approved
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
- **R2 — Root-clutter gate (tracked entries only).** Defined over `git ls-files`
  top-level entries — untracked/ignored dirs (`node_modules/`, `dist/`, `reports/`)
  are out of scope by construction. An unexpected TRACKED top-level entry fails with
  "agents treat root files as authoritative — move it to docs/ or delete it".
- **R3 — PR-title lint.** Squash-only merging makes the PR title the permanent commit
  subject. A `pull_request`-triggered check enforces conventional-commit shape
  (`type(scope)?: subject`, type ∈ feat|fix|docs|chore|test|refactor|ci|perf, subject
  ≤ 72 chars) — plus a finite banned-phrase list (case-insensitive: `founder`,
  `Altimate`) reusing SPEC-0004's voice rule; no open-ended "framing" judgment.
- **R4 — Determinism gate in CI.** The verify job runs, verbatim:
  `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`.
  verify-goldens re-renders every corpus receipt each run, so inter-run byte drift in
  the render path fails even though a single goldens pass would succeed (this is what
  the existing single goldens step cannot catch).
- **R5 — Workflow lint.** `actionlint`, pinned to an exact release version with a
  checksum-verified binary download (never `latest`), validates `.github/workflows/*`
  on PRs touching them. Version bumps are ordinary reviewed PRs; a runner-label
  false-positive is logged per R8 and the check adjusted, not disabled.
- **R6 — Secret scan.** The MIT `gitleaks` CLI (pinned version, checksum-verified —
  deliberately NOT gitleaks-action, whose org licensing is a future trap) scans the PR
  diff on every PR and full history on manual dispatch (the pre-OSS-flip button). Any
  finding blocks. **Suppression governance:** suppressions live only in
  `.gitleaksignore`, and every entry must carry a `# reason:` comment on the preceding
  line — the hygiene script fails on reasonless entries, so routing around the scanner
  is itself a gated, reviewed act.
- **R7 — One local entrypoint (scoped honestly).** `node scripts/hygiene.mjs` runs
  the fast constitution checks — R1, R2, R6's suppression-governance check, and R3's
  title lint given a `--title "<t>"` argument. R4/R5/R6-scan run via their own
  documented commands (listed in the script's `--help`). CI and the script share one
  rules module — no CI-vs-local drift.
- **R8 — False-positive log.** `docs/internal/hygiene-fp-log.md`: any false or overridden gate
  finding is appended (date · gate · cause · action). This makes the kill criterion
  ("two FPs in a month → fix or delete the gate") measurable instead of vibes.

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
| R3 title shapes | "updates" / 80-char subject / "feat: ok" | fail / fail / pass |
| R3 banned phrase | title containing a banned word | fail, names the list |
| R4 determinism | goldens ×10 frozen env | exit 0 today; drift-injection unit test exits 1 |
| R5 workflow lint | valid + broken workflow fixture | pass / fail |
| R6 secret scan | leaked-key fixture in a test branch diff | blocking failure |
| R6 suppression governance | .gitleaksignore entry without # reason: | hygiene script exit 1 |
| R8 fp log | overridden finding | entry appended in documented format |
| R7 parity | hygiene.mjs vs CI job rules | same allowlist/budget constants (one module) |

## Success criteria

- [ ] All gates green on the current repo as-is (proving current cleanliness), and each
      gate demonstrated failing on its fixture in tests.
- [ ] Unmasked gate + spec-lint green; hygiene checks added to AGENTS.md's verification
      block without exceeding its own budget (the recursion is the point).

## Validation

**2026-07-02 · S1 (self):** the spec's own origin is an I3 catch — AGENTS.md claimed a
CI-enforced budget no CI job enforced. **S2 (Codex): REWORK → reworked same day.**
Accepted all 8: R7 claim narrowed to what the script actually runs; R4 given the exact
verbatim command and its non-redundancy rationale; R2 defined over tracked files only;
R3 voice clause reduced to a finite banned-phrase list; R5 pinning made concrete
(checksum-verified, never latest); R6 switched to the MIT gitleaks CLI (action licensing
trap) + suppression governance (reasonless .gitleaksignore entries fail); R8 FP log
added so the kill criterion is measurable. **S3 (value):** maintainer requested this
directly (2026-07-02); the R1 gate closes a live constitution contradiction. **S4:**
spec-lint green. Approval basis: explicit maintainer request.
