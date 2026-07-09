# OpenSSF Best Practices badge — answer sheet

Register the project at **https://bestpractices.dev** ("Get Your Badge Now",
sign in with GitHub, add `https://github.com/anandgupta42/receipts`). Then work
through the **passing** questionnaire. Below is every passing-level criterion
that needs a specific answer, the answer to select, and the evidence URL to paste
into its justification box. Once the badge is earned, OpenSSF Scorecard's
`CII-Best-Practices` check flips from 0 to a high score on its next scan.

Base evidence URLs (reuse throughout):
- Repo: `https://github.com/anandgupta42/receipts`
- README: `https://github.com/anandgupta42/receipts/blob/main/README.md`
- CONTRIBUTING: `https://github.com/anandgupta42/receipts/blob/main/CONTRIBUTING.md`
- SECURITY: `https://github.com/anandgupta42/receipts/blob/main/SECURITY.md`
- LICENSE: `https://github.com/anandgupta42/receipts/blob/main/LICENSE`
- CHANGELOG: `https://github.com/anandgupta42/receipts/blob/main/docs/CHANGELOG.md`
- CI workflows: `https://github.com/anandgupta42/receipts/tree/main/.github/workflows`
- Docs site: `https://anandgupta42.github.io/receipts/` (adjust if different)

## Basics

| Criterion | Answer | Justification / URL |
|---|---|---|
| `description_good` | Met | README opens with a one-line description and "Why this exists." — README URL. |
| `interact` | Met | CONTRIBUTING.md documents how to contribute; GitHub Issues enabled — CONTRIBUTING URL. |
| `contribution` | Met | CONTRIBUTING.md — CONTRIBUTING URL. |
| `contribution_requirements` | Met | CONTRIBUTING.md states style/commit/spec requirements (conventional commits, spec-first) — CONTRIBUTING URL. |
| `floss_license` | Met | Apache-2.0 — LICENSE URL. |
| `floss_license_osi` | Met | Apache-2.0 is OSI-approved. |
| `license_location` | Met | `LICENSE` at repo root — LICENSE URL. |
| `documentation_basics` | Met | README + `docs/` guide — README URL and `docs/` tree. |
| `documentation_interface` | Met | `docs/guide/` + `aireceipts --help` (golden-tested) — `docs/guide` tree. |
| `english` | Met | All docs are in English. |

## Change control

| Criterion | Answer | Justification / URL |
|---|---|---|
| `repo_public` | Met | Public GitHub repo — Repo URL. |
| `repo_track` | Met | Git — full history on GitHub. |
| `repo_interim` | Met | Development happens on branches merged via PR — Repo URL (Pull requests). |
| `repo_distributed` | Met | Git is distributed. |
| `version_unique` | Met | SemVer, one version per release — CHANGELOG URL + `package.json`. |
| `version_semver` | Met | SemVer. |
| `version_tags` | Met | Annotated `vX.Y.Z` tags minted by the publish workflow — `https://github.com/anandgupta42/receipts/tags`. |
| `release_notes` | Met | Per-version notes in CHANGELOG + GitHub Releases — CHANGELOG URL. |
| `release_notes_vulns` | Met | Security-relevant fixes are called out in the changelog entries — CHANGELOG URL. |

## Reporting

| Criterion | Answer | Justification / URL |
|---|---|---|
| `report_process` | Met | GitHub Issues for bugs; SECURITY.md for vulnerabilities — Repo Issues + SECURITY URL. |
| `report_tracker` | Met | GitHub Issues. |
| `report_responses` | Met | Maintainer triages issues; SECURITY.md commits to acknowledgment "within a few days" — SECURITY URL. |
| `enhancement_responses` | Met | Enhancement requests handled via Issues/specs — Repo URL. |
| `report_archive` | Met | Issues + PRs are publicly archived on GitHub — Repo URL. |
| `vulnerability_report_process` | Met | SECURITY.md — private GitHub Security Advisories — SECURITY URL. |
| `vulnerability_report_private` | Met | Private reporting via GitHub Security Advisories (link in SECURITY.md) — SECURITY URL. |
| `vulnerability_report_response` | Met | SECURITY.md states the response timeline — SECURITY URL. |

## Quality

| Criterion | Answer | Justification / URL |
|---|---|---|
| `build` | Met | `npm run build` (tsup) — `package.json` scripts. |
| `build_common_tools` | Met | Node + npm + tsup. |
| `build_floss_tools` | Met | All build tools are FLOSS. |
| `test` | Met | Vitest suite (1748 tests) — CI workflows URL (`ci.yml`). |
| `test_invocation` | Met | `npx vitest run` — documented in AGENTS.md verification block. |
| `test_most` | Met | High coverage; pricing is mutation-tested (Stryker) — `mutation.yml`. |
| `test_continuous_integration` | Met | Every push/PR runs the full suite — `ci.yml`. |
| `test_policy` | Met | AGENTS.md / CONTRIBUTING require tests for new features — CONTRIBUTING URL. |
| `tests_are_added` | Met | New features ship with tests (spec-first workflow) — CONTRIBUTING URL. |
| `tests_documented_added` | Met | Documented in AGENTS.md. |
| `warnings` | Met | `eslint --max-warnings 0` + `tsc --noEmit` strict — `ci.yml`. |
| `warnings_fixed` | Met | CI fails on any warning (`--max-warnings 0`). |
| `warnings_strict` | Met | TypeScript `strict: true` + zero-warning ESLint — `tsconfig.json`. |

## Security

| Criterion | Answer | Justification / URL |
|---|---|---|
| `know_secure_design` | Met | Documented trust boundaries (`docs/trust.md`, `docs/telemetry.md`); no new local trust boundary (SECURITY.md scope). |
| `know_common_errors` | Met | CI runs CodeQL (SAST), gitleaks, zizmor/actionlint on workflows. |
| `crypto_*` (crypto criteria) | N/A | The tool performs no cryptography; it reads local files and computes costs offline. Mark each crypto criterion **N/A** with this note. |
| `delivery_mitm` | Met | Distributed over HTTPS (npm) and git; npm publish uses OIDC provenance — `release-publish.yml`. |
| `delivery_unsigned` | Met | Published with npm provenance attestation (OIDC, no token) — `release-publish.yml`. |
| `vulnerabilities_fixed_60_days` | Met | `npm audit` is clean; dependency advisories patched promptly (Dependabot + overrides). |
| `vulnerabilities_critical_fixed` | Met | No open critical/high advisories — `npm audit`. |
| `no_leaked_credentials` | Met | gitleaks scans every PR and full history in CI — `hygiene.yml` / `ci.yml`. |

## Analysis

| Criterion | Answer | Justification / URL |
|---|---|---|
| `static_analysis` | Met | ESLint + `tsc` + CodeQL (SAST) in CI — CI workflows URL. |
| `static_analysis_common_vulnerabilities` | Met | CodeQL default security queries — `github/codeql-action`. |
| `static_analysis_fixed` | Met | CI blocks merge on findings. |
| `static_analysis_often` | Met | Runs on every PR + scheduled. |
| `dynamic_analysis` | Met | fast-check property tests on pricing/parsing + Stryker mutation testing — `mutation.yml`, `vitest.config.ts`. |
| `dynamic_analysis_unsafe` | N/A | Memory-safe language (TypeScript/Node); no manual memory management. |

## Notes for the two criteria most likely to need thought

- **`report_responses` / `vulnerability_report_response`:** the passing badge
  wants evidence you *respond* to reports. SECURITY.md already commits to a
  timeline; that's sufficient for the questionnaire.
- **Crypto criteria:** answer **N/A** (not "Unmet"). This is a local, offline
  cost-reporting CLI with no cryptographic functionality; N/A is the correct and
  accepted answer and does not cost points.
