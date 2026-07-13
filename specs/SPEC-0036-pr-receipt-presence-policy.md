---
id: SPEC-0036
title: "PR receipt presence policy - notice by default, opt-in enforcement"
status: shipped
milestone: M4
depends: [SPEC-0019]
---

# SPEC-0036 · PR receipt presence policy

Invariants: I1 (the check is deterministic over GitHub comment JSON; no model calls),
I3 (the check reports presence/absence only, never invents a cost), I4 (receipt
generation stays local; CI never receives transcripts), I5 (comment marker remains the
stable contract), I6 (the check is a fact, not a ranking or quality verdict).

## Purpose

SPEC-0019 made PR receipts possible with local generation plus CI presence verification.
The UX gap is policy: a universal PR trigger should remind every author, but failing PRs
by default is a poor contributor experience. This delta keeps the workflow notice-only
unless a maintainer explicitly opts into same-repo enforcement, while making the hard
boundary clear: GitHub Actions can check for the marked comment on any PR creation path,
but it cannot generate a real receipt because the source transcripts live on the
developer's machine.

This spec records the approval gate for PR #69's provisional implementation; maintainer
approval converted that implementation from provisional to accepted.

## Requirements

- **R1 - Universal presence check, advisory by default.** The repo workflow remains a
  `pull_request` check for `opened`, `synchronize`, and `reopened` events
  (`.github/workflows/pr-receipt-check.yml:7-9`). When a marked receipt comment is
  missing and no enforcement option is enabled, the workflow emits only a GitHub
  `::notice::` and exits 0. This is the default for every adopter.
- **R2 - Explicit same-repo enforcement option.** Maintainers may set repository
  variable `AIRECEIPTS_REQUIRE_PR_RECEIPT=true`. Only that literal value enables the
  blocking path. With that option enabled, a missing receipt on a same-repo PR
  (`head.repo.full_name == github.repository`) becomes `missing-required`; the workflow
  emits `::error::` and exits 1. The failure message must tell the author to run
  `npx aireceipts pr --post` locally and rerun the check.
  Amendment (maintainer-directed, 2026-07-13): branches matching repository variable
  `AIRECEIPTS_RECEIPT_EXEMPT_GLOBS` (space-separated anchored globs, `*` wildcards only;
  the workflow defaults to `release/*` when the variable is unset) stay notice-only even
  under enforcement. Release checkouts are authored without a capturable agent session,
  so no receipt can exist for them; a hard requirement there would block every release
  PR. Keep patterns narrow so feature work cannot slip through. The verdict logic lives
  in `scripts/check-pr-receipt.mjs` (`isExemptRef`), gated by unit tests.
- **R3 - Fork PRs remain notice-only.** Fork PRs never fail this check, even when R2 is
  enabled. The workflow may not assume a fork contributor has local agent sessions for
  the base repo, and it may not pressure them to upload transcripts.
- **R4 - CI never generates the receipt.** Receipt generation and posting remain owned by
  `aireceipts pr --post`: `runPr` renders before posting (`src/pr/index.ts:216-292`),
  `renderPrBody` emits the marked comment body (`src/pr/body.ts:337-366`), and
  `upsertPrComment` performs the authenticated `gh` comment upsert
  (`src/pr/comment.ts:77-119`). The CI workflow reads issue comments only; it never
  scans local transcript paths, uploads artifacts, calls models, or synthesizes receipt
  content.
- **R5 - Pure verdict script, shell policy caller.** `scripts/check-pr-receipt.mjs`
  owns the deterministic marker verdict. It parses GitHub issue-comment JSON, mirrors
  the dogfood marker (`scripts/check-pr-receipt.mjs:8-10`), and returns one of
  `found`, `missing-notice`, or `missing-required` when repo metadata is supplied
  (`scripts/check-pr-receipt.mjs:26-40`). The script itself exits 0; the workflow owns
  policy and blocking (`.github/workflows/pr-receipt-check.yml:27-50`). Existing
  `found`/`missing` CLI output without repo metadata stays available for the older
  SPEC-0019 caller contract.
- **R6 - Documentation names the tradeoff.** `docs/pr-receipts.md` must state that CI is
  notice-only by default, how to enable same-repo enforcement, that forks stay advisory,
  and that CI cannot generate the receipt because transcripts remain local
  (`docs/pr-receipts.md:71-75`).

## Scenarios

- **Given** a same-repo PR without a receipt and no repo variable, **when** the workflow
  runs, **then** it emits `missing-notice`, prints a `::notice::`, and exits 0.
- **Given** a same-repo PR without a receipt and
  `AIRECEIPTS_REQUIRE_PR_RECEIPT=true`, **when** the workflow runs, **then** it emits
  `missing-required`, prints a `::error::`, and exits 1.
- **Given** a fork PR without a receipt and enforcement enabled, **when** the workflow
  runs, **then** it emits `missing-notice` and exits 0.
- **Given** any PR with a comment whose body starts with
  `<!-- aireceipts-dogfood -->`, **when** the workflow runs, **then** it emits `found`
  and exits 0.
- **Given** a PR created through the GitHub UI, API, or `gh pr create`, **when** GitHub
  fires the `pull_request` event, **then** the presence check runs; generation still
  requires a local `npx aireceipts pr --post`.

## Non-goals

- **Local git hooks as the universal mechanism.** A local hook can help a developer who
  uses that checkout, but it cannot fire for PRs opened from the GitHub UI, API, or a
  different machine. The universal mechanism is the GitHub `pull_request` workflow.
- **Default blocking.** The default remains contributor-friendly: visible reminder,
  green checks.
- **Fork blocking.** A separate maintainer decision would be required to ever block fork
  PRs; this spec deliberately does not.
- **CI receipt generation, transcript upload, or remote attestation.** Those would
  violate the local-first trust boundary (I4) and turn a presence check into a different
  product.
- **A bot comment that posts instructions.** Notices are enough for this delta; comment
  spam is worse than a neutral check annotation.

## Design

The receipt body already has a stable marker: `renderPrBody` prepends
`DOGFOOD_MARKER` before the fenced receipt (`src/pr/body.ts:337-366`), and the posting
path finds/updates a single matching comment via `upsertPrComment`
(`src/pr/comment.ts:77-119`). The CI script should stay intentionally smaller than the
product command: parse the comments JSON, check for the same marker, and classify the
absence based on explicit workflow inputs.

The workflow is the only universal PR-creation hook. It runs on GitHub's
`pull_request` event, reads comments through `gh api`, and passes `HEAD_REPO`,
`BASE_REPO`, and the optional repo variable into the script. The shell layer maps
`missing-required` to an error only when the maintainer enabled the option; all other
missing states are advisory. This keeps the UX policy in a place maintainers can audit
without adding product-path network behavior.

The contributor docs are part of the feature, not afterthought copy. They must explain
why a missing receipt can be visible without being blocking: the check can see the PR,
but only the author's machine has the transcript material needed for a real cost
receipt.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 marker present | comments JSON with marked body | `found` |
| R1 default same-repo | `headRepo == baseRepo`, no enforcement | `missing-notice`; workflow notice path exits 0 |
| R2 enforced same-repo | `headRepo == baseRepo`, enforcement enabled | `missing-required`; workflow error path exits 1 |
| R2 truthy strictness | repo variable not exactly `true` | default advisory path |
| R3 enforced fork | `headRepo != baseRepo`, enforcement enabled | `missing-notice`; workflow exits 0 |
| R4 local generation preserved | `aireceipts pr --post` | still prints body before `gh` upsert and updates one marked comment |
| R4 no product network expansion | CLI receipt path | no new network calls outside explicit `gh` posting/checking surfaces |
| R5 unknown repos | no repo metadata | legacy `missing` or policy `missing-notice`, never blocking |
| R5 invalid comments JSON | malformed input | missing verdict, never crash |
| R5 workflow wiring | workflow text | contains repo variable, `--require-same-repo`, notice path, error path |
| R6 docs tradeoff | `docs/pr-receipts.md` | names default notice-only, opt-in enforcement, fork behavior, no CI generation |

## Success criteria

- [x] Maintainer approves this draft before the implementation is considered accepted.
- [x] `scripts/check-pr-receipt.mjs` has unit coverage for default, enforced same-repo,
      enforced fork, marker present, marker absent, and invalid JSON.
- [x] `.github/workflows/pr-receipt-check.yml` is notice-only by default and has an
      opt-in same-repo blocking path keyed by `AIRECEIPTS_REQUIRE_PR_RECEIPT=true`.
- [x] `docs/pr-receipts.md` calls out the UX tradeoffs: default notice-only,
      opt-in enforcement, fork behavior, and no CI receipt generation.
- [x] Acceptance testing performed live: script returns `missing-notice` for default
      same-repo and `missing-required` only with `--require-same-repo`.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, and `node scripts/hygiene.mjs` all pass unmasked.
- [x] The PR receipt comment is updated after the accepted implementation commit.

## Open questions

- **Variable name.** Proposed default: keep `AIRECEIPTS_REQUIRE_PR_RECEIPT`; it is
  explicit, scoped to this product, and hard to confuse with product telemetry or
  runtime config.
- **Exact truthy values.** Proposed default: only the literal string `true` enables
  enforcement. Anything else is advisory to avoid surprising maintainers.
- **Whether to keep the older `found`/`missing` CLI output.** Proposed default: keep it
  for compatibility with SPEC-0019-era scripts and only use tri-state verdicts when repo
  metadata is supplied.

## Validation

**2026-07-04 · S1 (self):** The design preserves I4: GitHub Actions verifies comment
presence but never generates a receipt or sees transcripts. Default notice-only avoids
the contributor-hostile failure mode the maintainer rejected. Same-repo enforcement is
still available for repos that deliberately want it, and the fork path stays advisory.
The script is deterministic over provided JSON and the workflow policy is explicit.

**2026-07-04 · S2 (maintainer review): APPROVED.** Maintainer approved the spec
in-session ("spec approved"). Button 1 exercised; the PR #69 implementation may now be
treated as accepted rather than provisional.

**2026-07-04 · S3 (live acceptance): PASS.** Direct script probes:
same-repo default → `missing-notice`; same-repo with `--require-same-repo` →
`missing-required`; fork with `--require-same-repo` → `missing-notice`. Focused unit
coverage lives in `test/pr/check-pr-receipt.test.ts`; workflow/doc wiring coverage lives
in `test/pr/wiring-docs.test.ts`.

**2026-07-04 · S4 (gate + dogfood): PASS.** Full AGENTS verification block passed
unmasked after the spec landed: `npx tsc --noEmit` 0, `npx eslint . --max-warnings 0`
0, `npx vitest run` 964 tests passed, goldens byte-identical, determinism 10/10
byte-identical, `spec-lint` 29 specs OK, hygiene OK. `node dist/cli.js pr --post`
updated the marked receipt comment on PR #69 after the accepted implementation/spec
commits.
