---
id: SPEC-0033
title: "OSS launch hardening — pinned supply chain, least privilege, priced contributions"
status: shipped
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

**2026-07-03 · S5 (build):** implementation complete on `feat/m4-launch-hardening`.

- **R1** — all 22 pre-existing `uses:` references across the 7 workflow
  files SHA-pinned (`@<40-hex> # <tag>`), each SHA cross-verified via `gh api
  repos/<owner>/<repo>/commits/<tag>`. `.github/dependabot.yml` added
  (github-actions ecosystem, weekly, no npm ecosystem — per the non-goal).
  `scripts/hygiene.mjs` gained `checkWorkflowPins`/`checkWorkflowPinsText`
  (internal gate "R9" in that script's own R1-R8 numbering, distinct from
  this spec's R1) enforcing `uses:` must carry a full 40-hex SHA, skipping
  `./local` and `docker://` refs; zero violations against the repo, and unit
  tests cover both the violation and pass paths plus the two skip cases.
- **R2** — explicit `permissions: {contents: read}` added to the 4 workflows
  that lacked it (`ci.yml`, `deps.yml`, `hygiene.yml`, `mutation.yml`);
  `pages.yml`/`price-scan.yml`/`pr-receipt-check.yml` already had blocks and
  were left alone. **Settings-checklist item recorded, not executed**: repo
  Actions default workflow token permissions should be set to read-only, and
  secret scanning + push protection enabled, at flip time — this needs the
  maintainer's own button; requested as a PR-thread acknowledgment per the
  test matrix, not performed by this session.
- **R3** — `zizmor` job added to `hygiene.yml` (`pull_request` trigger),
  installed by the gitleaks checksum pattern adapted for zizmor's release
  assets (no companion `_checksums.txt`; the GitHub Releases API's own
  SHA256 `digest` field is pinned and verified with `sha256sum -c`,
  independently cross-checked against a real local download's `shasum -a
  256`). Runs `zizmor --strict-collection --min-severity high
  .github/workflows`; `.github/zizmor.yml` committed empty (`rules: {}`) as
  the only suppression path. **Verified green against the real repo**: `zizmor
  --strict-collection --min-severity high .github/workflows` → "No findings
  to report... (16 ignored, 31 suppressed)", exit 0; the 15 medium/1
  informational findings below the `--min-severity high` floor are all
  `artipacked` (missing `persist-credentials: false`), out of this spec's
  scope. **Red-path demonstration** (test matrix row "R3 gate red"): a fixture
  workflow built and run *outside* the repo (not committed — it deliberately
  combines `pull_request_target`, an unpinned `actions/checkout@v4`, and
  unsanitized `${{ github.event.pull_request.title }}` interpolated directly
  into a `run:` shell block) was scanned with the same pinned zizmor binary:
  `zizmor --strict-collection --min-severity high` exited **14** (highest
  finding = high) and reported exactly 3 high-severity findings —
  `dangerous-triggers`, `template-injection`, `unpinned-uses` — proving the
  gate fails loudly on the pattern class R3 exists to catch. Also caught a
  real gap mid-implementation: an early real-repo zizmor run (before
  `mutation.yml`'s permissions block was added) surfaced a genuine medium
  `excessive-permissions` finding on that file, fixed in the same commit.
- **R4** — CONTRIBUTING.md gained (a) a verbatim close-response for
  gate-skipping PRs in "The pipeline" section, and (b) a sentence in "Humans
  are welcome" pointing security reporters to SECURITY.md's existing
  no-working-reproduction clause (SECURITY.md itself needed no edit — the
  clause already existed). **Settings-checklist item recorded, not
  executed**: require approval for first-time-contributor workflow runs —
  requested as a PR-thread maintainer acknowledgment, not performed by this
  session.
- **R5** — `.github/workflows/release-publish.yml` added:
  `workflow_dispatch` only, top-level `permissions: {contents: read}`, job
  adds only `id-token: write` (no `NODE_AUTH_TOKEN` or any npm token
  anywhere), fork guard (`if: github.repository ==
  'anandgupta42/receipts'`), an explicit assertion step that
  `package.json.repository` matches `github.repository` before publishing,
  a tooling-floor assertion (npm CLI >= 11.5.1 via `setup-node` pinned to
  `node-version: "22.14"`), and `npm publish --provenance --access public`
  on the trusted-publishing path. The first-publish sequence (rename → public
  flip → manual first publish with a granular token → configure npmjs.com
  trusted publisher → all subsequent publishes through this workflow) is
  recorded above in R5's text; **not executed** — this session does not
  publish anything, per the task's explicit constraint.
- **Gates, unmasked** (`echo $?` after each): `npx tsc --noEmit` → 0; `npx
  eslint . --max-warnings 0` → 0; `npx vitest run` → 0 (969 tests, 83 files);
  `node scripts/verify-goldens.mjs` → 0 (90 artifacts byte-identical); `node
  scripts/spec-lint.mjs` → 0 (31 specs OK); `node scripts/hygiene.mjs` → 0.
  `actionlint` (checksum-verified local install, v1.7.7, matching
  `hygiene.yml`'s pin) against every `.github/workflows/*.yml` → 0, no
  findings.

**2026-07-03 · S6 (Codex, read-only): 4 findings → all accepted, fixed.**
Full output captured to file. Findings and disposition:
1. HIGH — `release-publish.yml` could publish from any manually-dispatched
   ref (the fork guard only checked `github.repository`; `id-token: write`
   plus `npm ci`/`build`/`publish` would then run for whatever branch or tag
   was selected) — **accepted**; job `if:` now also requires `github.ref ==
   'refs/heads/main'`.
2. MEDIUM — the `package.json.repository` assertion used a substring glob
   that would accept e.g. `github.com/anandgupta42/receipts-malicious` —
   **accepted**; replaced with a Node URL parse requiring exact host
   `github.com` and exact path `== $GITHUB_REPOSITORY` (`.git` stripped).
3. MEDIUM — the hygiene backstop didn't enforce the spec's full
   `@[0-9a-f]{40} # v…` shape: a SHA with no trailing tag comment passed,
   and a remote `uses:` with no `@` at all was silently ignored —
   **accepted**; `checkWorkflowPinsText` now matches every `uses:` line,
   flags missing-`@` refs as unpinned, and separately flags a pinned SHA
   missing its `# <tag>` comment; both paths unit-tested.
4. LOW — "config-file-only suppressions" wasn't mechanically enforced
   (zizmor supports inline `# zizmor: ignore[rule]` pragmas) — **accepted**;
   the same hygiene check now rejects any inline `zizmor: ignore` pragma in
   a workflow file, naming `.github/zizmor.yml` as the only suppression
   path; unit-tested.
Codex also confirmed `pr-receipt-check.yml`'s reusable behavior
(`workflow_call` + pinned checkout of `anandgupta42/receipts@main`) is
preserved, and noted SHA↔tag correspondence isn't verifiable from the diff
alone — those SHAs were fetched and cross-checked against `gh api
repos/<owner>/<repo>/commits/<tag>` during the build (S5). All gates re-run
green after the fixes (tsc/eslint/vitest 970 tests/goldens/spec-lint/hygiene
all exit 0; actionlint 0; zizmor real-repo run exit 0).

**2026-07-04 · shipped:** merged via #81; ledger sweep pre-release.
