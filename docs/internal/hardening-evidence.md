# Why the launch hardening looks the way it does (SPEC-0033 evidence note)

Citations behind SPEC-0033's requirements, so the posture is explainable
from inside the repo. Gathered 2026-07-03.

## Actions pinning (R1)

- tj-actions/changed-files compromise (2025-03, CVE-2025-30066, ~23k repos):
  attackers retagged existing version tags to a malicious commit that
  dumped CI secrets to logs; SHA-pinned consumers were unaffected.
  https://www.wiz.io/blog/github-actions-security-guide ·
  https://orca.security/resources/blog/github-action-tj-actions-changed-files-compromised/
- GitHub's own secure-use reference: full-length commit SHA is the only
  immutable way to use an action.
  https://docs.github.com/en/actions/reference/security/secure-use
- This repo today: 22 `uses:` references across 7 workflows, all tag-pinned
  (`@v4`-style), zero SHA-pinned. Counterweight precedent already in-repo:
  `hygiene.yml` installs gitleaks checksum-verified.
- Pin freshness: Dependabot `github-actions` ecosystem updates SHA pins with
  the tag in a trailing comment; low PR volume for 7 workflows.

## Token scope (R2)

- 4 of 7 workflows (`ci.yml`, `deps.yml`, `hygiene.yml`, `mutation.yml`)
  carry no `permissions:` block and inherit repo defaults; explicit
  least-privilege blocks are the consensus regardless of account defaults
  (zizmor `excessive-permissions` audit).
  https://docs.zizmor.sh/usage/ · https://www.wiz.io/blog/github-actions-security-guide

## Static analysis for workflows (R3)

- zizmor: purpose-built static analysis for GitHub Actions (template
  injection, excessive permissions, unpinned uses); seconds to run;
  `--fix=all` automates the initial SHA-pin migration.
  https://github.com/zizmorcore/zizmor · https://docs.zizmor.sh/quickstart/
  · Grafana at-scale writeup:
  https://grafana.com/blog/how-to-detect-vulnerable-github-actions-at-scale-with-zizmor/

## Community intake in the slop era (R4)

- curl: ~20% of 2025 bug-bounty submissions were AI slop; bounty ended
  2026-01, reopened without monetary rewards; repro requirements stressed.
  https://thenewstack.io/curls-daniel-stenberg-ai-is-ddosing-open-source-and-fixing-its-bugs/
- Ghostty: AI contributions restricted to pre-approved issues; "vouch"
  trust experiments. tldraw: auto-closes external PRs. GitHub is
  considering PR kill switches for maintainers.
  https://www.theregister.com/2026/02/03/github_kill_switch_pull_requests_ai/
- GitHub's 2026 OSS report: "a denial-of-service attack on human attention."
- This repo's stance is deliberately different (and is the product's own
  thesis): contributions are judged by evidence, not authorship — the gates
  are identical for humans and agents, and PRs carry cost receipts. We
  don't ban AI contributions; we price them. SECURITY.md already requires
  a working reproduction (the exact curl lesson), and its scope already
  treats fabricated dollars and telemetry leaks as security-grade.

## Publish path (R5)

- npm classic tokens permanently revoked 2025-12-09; granular tokens 90-day
  max. Trusted publishing (OIDC) GA since 2025-07; provenance attestations
  generated automatically on that path.
  https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/
  · https://docs.npmjs.com/trusted-publishers/
- Constraints that order our launch steps: provenance is NOT generated for
  private repos (publish after the public flip); `package.json.repository`
  must match the repo (after the SPEC-0030 rename); npm's docs describe configuring
  trusted publishers for existing packages; the first publish of a NEW
  package name is thinner ground — plan for a manual granular-token
  publish with explicit `--provenance`, verify live, record what actually
  worked; `id-token: write` needed; npm CLI ≥ 11.5.1, Node ≥ 22.14;
  `NODE_AUTH_TOKEN` must be entirely unset for OIDC to engage.
  https://philna.sh/blog/2026/01/28/trusted-publishing-npm/
