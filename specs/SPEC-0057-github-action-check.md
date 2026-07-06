---
id: SPEC-0057
title: "Root composite GitHub Action — the receipt check as a Marketplace-listable unit"
status: building
milestone: M5
depends: [SPEC-0019, SPEC-0030]
---

# SPEC-0057: Root composite GitHub Action — the receipt check as a Marketplace-listable unit

## Purpose

The PR-receipt presence check exists today as a reusable workflow
(`.github/workflows/pr-receipt-check.yml` + 3-line caller). A reusable workflow
cannot be listed on the GitHub Marketplace; a repo-root `action.yml` can. This
spec packages the same check as a composite action so it becomes discoverable
(Marketplace search, `uses: anandgupta42/receipts@…` autocomplete) without
changing what runs: the action still only READS PR comments looking for the
marked receipt — generation stays on the developer's machine (SPEC-0052's
decision holds; the action runs in the adopter's own runner). Serves the
adoption goal of SPEC-0030 and I4 (local-first: the check needs `contents:
read`/`pull-requests: read` only). Maintainer-directed (2026-07-05): ship the
packaging; the Marketplace listing click itself is the maintainer's (release
skill/button territory).

## Requirements

- **R1 — Root `action.yml`, composite.** A composite action at the repo root:
  inputs `require-receipt` (default `"false"`) and `github-token` (default
  `${{ github.token }}`); steps that fetch the PR's issue comments via `gh api`
  and evaluate them with the SAME `scripts/check-pr-receipt.mjs` (checked out
  from this repo at the action's own ref — never the caller's repo, so a PR
  cannot tamper with the verdict logic). Verdict semantics identical to the
  workflow: `found` → pass; `missing-required` → error exit 1 (only when
  `require-receipt: true` and the PR is same-repo); `missing-notice` → neutral
  `::notice`, exit 0.
- **R2 — No duplicated verdict logic.** The action shells into
  `scripts/check-pr-receipt.mjs`; no logic is copied into YAML beyond arg
  plumbing (the no-duplicated-truths rule).
- **R3 — Branding + metadata.** `action.yml` carries `name`, `description`,
  `branding` (icon/color) — required fields for a Marketplace listing.
- **R4 — Docs.** `docs/pr-receipts.md` maintainer section offers both paths:
  the action (`uses: anandgupta42/receipts@main` under `steps:`) and the
  existing reusable-workflow caller; `docs/adopt/pr-receipt-check-action.yml`
  is the paste-ready caller file. `docs/internal/releasing.md` gains the
  maintainer-only Marketplace steps (publish checkbox on a release, major tag
  `v0` maintenance).
- **R5 — Hygiene + guards.** `action.yml` joins `ROOT_ALLOWLIST` in
  `scripts/hygiene.mjs` (with its rationale comment); a test pins the action's
  metadata shape (valid YAML, composite, branding present, inputs' defaults)
  and its use of `scripts/check-pr-receipt.mjs` — so the action cannot drift
  from the script it wraps.
- **R6 — Dogfood.** This repo's own `pr-receipt-check.yml` workflow keeps the
  reusable-workflow form (it IS the reusable workflow); no self-migration —
  one implementation, two packagings.

## Scenarios

- **Given** an adopter repo with the action in a `pull_request` workflow and no
  receipt comment, **When** the job runs with defaults, **Then** it emits a
  neutral notice naming `npx aireceipts-cli pr --post` and exits 0.
- **Given** `require-receipt: true` on a same-repo PR with no receipt comment,
  **When** the job runs, **Then** it exits 1 with an error annotation.
- **Given** a fork PR under `require-receipt: true`, **When** the job runs,
  **Then** it stays notice-only (transcripts live on the contributor's machine).
- **Given** a PR carrying the marked comment, **When** the job runs, **Then**
  it passes with the "present" log line.

## Non-goals

- **Publishing to the Marketplace.** Requires the maintainer's account (accept
  developer agreement, tick "Publish this Action", cut a `v0` tag). R4 documents
  the steps; this spec does not perform them.
- **Generating receipts in CI.** Decided and recorded in SPEC-0052 — transcripts
  are not on the runner; the action checks presence only.
- **A Node-runtime action (`dist/` bundle).** Composite + `gh` keeps zero build
  artifacts in the repo root and reuses the checked-in script unchanged.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1/R3 metadata | parse `action.yml` | valid YAML; `runs.using: composite`; branding icon+color; inputs `require-receipt` default `"false"`, `github-token` defaulting to the workflow token |
| R2 wraps script | `action.yml` steps text | references `scripts/check-pr-receipt.mjs`; contains no `missing-required`/`missing-notice` string literals beyond verdict `case` arms (no re-implementation) |
| R1 checkout pin | `action.yml` steps text | checks out `anandgupta42/receipts` at the action ref, never the caller repo |
| R5 hygiene | `node scripts/hygiene.mjs` with `action.yml` at root | passes (allowlisted) |
| R4 docs parity | docs files | maintainer section shows both adoption paths; `docs/adopt/pr-receipt-check-action.yml` exists and parses |
| R6 dogfood unchanged | `.github/workflows/pr-receipt-check.yml` | untouched by this spec's diff — the reusable workflow remains this repo's own check |

## Success criteria

- [ ] R1–R6 implemented; guard test green.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass unmasked.
