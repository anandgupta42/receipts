---
id: SPEC-0033
title: "OSS launch hardening — pinned supply chain, least privilege, priced contributions"
status: building
milestone: M4
depends: [SPEC-0030] # draft in flight (PR #70) — R5 interlocks with its rename
---

# SPEC-0033 · launch hardening

Invariants: I1 (no gate here ever calls a model or the network in the
product path — hardening is CI/settings/docs surface only), I4 (nothing
added phones home; secret scanning and provenance are GitHub/npm-side),
I6 (the contribution policy judges evidence, never authorship).

## Purpose

The public flip converts this repo from "our fleet's workshop" into an
attack surface and an intake queue, on the same day. What actually burns
small devtool repos early is documented and recent, and the preventions below are all
settings/CI-surface changes (citations: `docs/internal/hardening-evidence.md`):

1. **Mutable action tags.** tj-actions/changed-files (2025-03): retagged
   versions dumped CI secrets across ~23k repos; SHA-pinned consumers were
   unaffected. This repo has 22 tag-pinned `uses:` references and zero SHA
   pins — while already knowing better (gitleaks installs checksum-verified
   in `hygiene.yml`).
2. **Over-scoped workflow tokens.** 4 of 7 workflows (`ci`, `deps`,
   `hygiene`, `mutation`) have no `permissions:` block and ride the repo
   default.
3. **Slop intake.** curl ended its bounty after ~20% AI-slop submissions;
   Ghostty restricts AI PRs; GitHub is designing PR kill switches. This
   repo cannot copy those policies without refuting itself — it is
   agent-built and its PRs carry receipts. Its answer is its own thesis:
   **evidence over authorship** — same gates for everyone, receipts
   encouraged, no-repro reports already out of scope in SECURITY.md.
4. **Publish-path drift.** npm classic tokens no longer exist (revoked
   2025-12); the 2026 path is trusted publishing + automatic provenance,
   with ordering constraints that interlock with SPEC-0030's rename
   (repository field must match; provenance needs a public repo; first
   publish is manual).

**Kill criterion:** (a) if Dependabot (github-actions ecosystem) opens more than 8 PRs in any
30-day window (countable from the PR list), the update cadence widens to
monthly — pins are never removed to reduce noise; (b) if the workflow
static-analysis gate (R3) produces a false positive that a config entry
cannot express, it demotes to advisory in the same PR that documents why; (c) if the first-publish sequence
fails on launch day, the fallback is a granular automation token used once
and revoked — never skipping provenance silently, and the deviation is
recorded in the release notes.

## Requirements

- **R1 — Every action SHA-pinned, pins kept fresh.** All 22 `uses:`
  references across `.github/workflows/*.yml` move to full 40-hex commit
  SHAs with the version as a trailing comment (`uses: actions/checkout@<sha>
  # v4`). `.github/dependabot.yml` is added with the `github-actions`
  ecosystem (weekly) so pins advance by reviewed PR instead of rotting.
  npm dependencies stay on the existing `deps.yml` audit cadence — no
  Dependabot npm ecosystem (solo-maintainer noise; the audit already fails
  CI on high). Enforcement: the R3 analyzer's unpinned-uses audit plus a
  `scripts/hygiene.mjs` check (`uses:` must match `@[0-9a-f]{40}`) so the
  rule survives even if the analyzer is ever demoted.
- **R2 — Least-privilege tokens everywhere.** Every workflow gets an
  explicit top-level `permissions:` block (`contents: read` baseline; jobs
  that need more declare it at job level — `pages.yml` already models
  this). A maintainer-settings checklist item (recorded in the spec, the
  maintainer's button): repo Actions default token permissions set to
  read-only, secret scanning + push protection enabled at flip time.
- **R3 — Workflow static analysis in CI.** A `zizmor` job joins
  `hygiene.yml`, installed by the exact gitleaks pattern already at
  `hygiene.yml:82-93`: `ZIZMOR_VERSION` env pin, GitHub release binary +
  the release's checksums file, `sha256sum -c` before execution (no
  bootstrap paradox: the analyzer is not an action reference; its version
  bump is a manual chore noted in a comment beside the pin). It runs
  `zizmor --strict-collection .github/workflows` with a committed
  `zizmor.yml` for accepted findings. High-severity findings
  fail the job; the config file is the only suppression path (auditable
  diffs, no inline pragmas).
- **R4 — Intake friction, minimal.** CONTRIBUTING.md already states the
  house position (gates don't care who wrote the diff; receipts carried by
  PRs) — R4 adds only the two missing pieces: (a) a committed one-liner
  close-response for submissions that ignore the gates (written once,
  pasted forever — curl's attention lesson), placed in CONTRIBUTING's
  pipeline section; (b) one sentence pointing security reporters from
  CONTRIBUTING to SECURITY.md's working-reproduction requirement. Repo
  settings (maintainer button, acknowledged in the implementation PR):
  require approval for first-time-contributor workflow runs.
- **R5 — The publish workflow, 2026-shaped.** `.github/workflows/
  release-publish.yml` (workflow_dispatch only, maintainer-triggered):
  `id-token: write`, no `NODE_AUTH_TOKEN` anywhere, `npm publish` on the
  trusted-publishing path with automatic provenance. The spec records the
  interlock with SPEC-0030/the flip: (1) rename first (`package.json
  repository` must match or provenance validation fails), (2) public flip
  (no provenance for private repos), (3) FIRST publish manual with a
  granular token then configure the trusted publisher on npmjs.com —
  VERIFY this first-publish path live on launch day and record the actual
  sequence in the release notes (the docs are firm for existing packages,
  thinner for brand-new names), (4) every subsequent publish through this
  workflow. Tooling floor recorded: npm CLI ≥ 11.5.1 and Node ≥ 22.14 on
  the runner; `npm publish --provenance` is passed explicitly (harmless on
  the OIDC path, required on the fallback). The workflow refuses to run
  from forks and asserts `package.json.repository` (added by SPEC-0030's
  cutover PR — a hard prerequisite) matches `github.repository` before
  publishing.

## Scenarios

- **Given** any upstream action retags a compromised version, **when** our
  workflows run, **then** they execute the pinned SHA, unaffected; the next
  Dependabot PR surfaces the new tag for review instead of auto-adoption.
- **Given** a workflow file is added with a tag-pinned action or no
  `permissions:` block, **then** hygiene/zizmor fails CI naming the file.
- **Given** an external agent-built PR arrives with gates green and a
  receipt attached, **then** nothing about the pipeline treats it
  differently from a human PR (I6 for people).
- **Given** launch day publishing, **then** the recorded sequence produces
  an npm package with provenance attestations, and `npm view aireceipts`
  shows the provenance badge.

## Non-goals

- **Banning or labeling AI contributions** — self-refuting here; the
  receipt is the accountability mechanism the slop debate is asking for.
- **CLA/DCO, bug bounty, vouch systems** — intake volume doesn't justify
  them; revisit on evidence (curl's arc says bounties attract slop).
- **Dependabot for npm packages** — the weekly audit gate already fails CI
  on high-severity; update PRs are noise at this dependency count (11).
- **SLSA levels / sigstore beyond npm's automatic provenance.**
- **Branch-protection review counts** — a solo maintainer with a
  hook-enforced independent-review gate already exceeds what a 1-approval
  rule would add; revisit when there are two humans.
- **Runner hardening (harden-runner action)** — egress policies add an
  external dependency to every job for marginal benefit at this secret
  surface (only `GITHUB_TOKEN` and Pages OIDC in CI today).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 pins | grep all workflows | every `uses:` matches `@[0-9a-f]{40} # v…`; zero tag-only refs |
| R1 dependabot | .github/dependabot.yml | github-actions ecosystem, weekly; NO npm ecosystem |
| R1 hygiene backstop | inject a tag-pinned uses in a fixture copy | hygiene check fails naming the file |
| R2 permissions | every file in .github/workflows/ (discovered dynamically) | explicit top-level `permissions:`; write scopes only at job level |
| R3 analyzer | hygiene.yml | zizmor installed checksum-verified; strict; config-file-only suppressions |
| R3 gate red | seed a template-injection pattern in a fixture workflow copy | zizmor flags it (documented red-path run in the PR) |
| R4 policy | CONTRIBUTING.md | AI-contributions section + committed close-response text; same-gates statement |
| R4 security pointer | CONTRIBUTING.md | links SECURITY.md's repro requirement |
| R5 workflow shape | release-publish.yml | workflow_dispatch only; id-token: write; no NODE_AUTH_TOKEN; fork guard; repository-field assertion |
| R5 sequence recorded | this spec | rename → flip → verified first publish → trusted publisher, in order |
| R5 provenance proof | post-first-publish | `npm view aireceipts` provenance attestation present; result pasted into release notes |
| R2/R4 settings ack | implementation PR thread | maintainer comment acknowledging: default token read-only, secret scanning + push protection, first-time-contributor approval |

## Success criteria

- [ ] All workflows SHA-pinned and permission-scoped; zizmor + hygiene
      backstop green in CI; a seeded red-path finding demonstrated in the
      PR.
- [ ] Dependabot's first pin-freshness PR arrives and is merged (proves the
      loop, not just the config).
- [ ] CONTRIBUTING/SECURITY updated; maintainer settings checklist
      acknowledged in the PR by the maintainer.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass
      unmasked (`echo $?`).

## Validation

**2026-07-03 · S1 (self):** every requirement lands as repo bytes, a CI
gate, or a maintainer-acknowledged settings item with its ack recorded in
the implementation PR; the two live-verification steps (first publish,
provenance badge) are matrix rows with paste-the-output acceptance. Repo
numbers verified by hand before drafting: 22 tag-pinned `uses:`, 4/7
workflows without `permissions:`, gitleaks checksum precedent at
`hygiene.yml:82-93`.

**2026-07-03 · S2 (Codex, read-only): REWORK → draft reworked.** Full
output captured to file. Findings and disposition:
1. HIGH — R5 depended on not-yet-landed SPEC-0030 artifacts and omitted
   tool floors — **accepted**; dependency annotated as in-flight (PR #70),
   `package.json.repository` named a hard prerequisite, npm ≥ 11.5.1 /
   Node ≥ 22.14 recorded.
2. HIGH — first-publish claim overstated its citations — **accepted**;
   evidence note softened to "thinner ground, verify live, record what
   worked"; `--provenance` passed explicitly on all paths.
3. MEDIUM — settings-checklist items and the provenance badge lacked
   matrix rows — **accepted**; ack-in-PR and paste-the-output rows added.
4. MEDIUM — "all 7 workflows" would go stale — **accepted**; dynamic
   discovery wording.
5. MEDIUM — zizmor install underspecified vs the gitleaks precedent —
   **accepted**; exact pattern (version env, release checksums,
   `sha256sum -c`) written into R3.
6. MEDIUM — unmeasurable language — **accepted**; kill criterion (a) now
   counts PRs per 30-day window; rhetoric trimmed or moved to evidence.
7. CUT R4 — **partially accepted**: the redundant policy prose is gone
   (CONTRIBUTING already says gates-not-authorship); R4 keeps only the two
   additive pieces (committed close-response, security-repro pointer) plus
   the settings ack. Full cut rejected: the close-response is the
   attention-defense curl's arc argues for, and no existing text provides
   it.

**2026-07-03 · S3 (value gate):** the tj-actions incident is the concrete
counterfactual — this repo's own CI dumps `GITHUB_TOKEN` into 7 workflows
that would have executed a retagged action today; SHA pins + read-only
tokens reduce that to reviewed-PR exposure. The slop-intake stance costs
two sentences and converts the product's own receipt mechanism into the
policy — no other project can make that move this cheaply.

**2026-07-03 · S4 (lint):** `node scripts/spec-lint.mjs` → 30 spec(s) OK,
exit 0.

**2026-07-03 · approved (button 1):** maintainer, in-session ("all specs approved").
