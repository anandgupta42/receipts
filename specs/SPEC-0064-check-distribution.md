---
id: SPEC-0064
title: PR-receipt check — release-pinned distribution and an npm-native pr-check
status: building
milestone: M5
depends: [SPEC-0019, SPEC-0030, SPEC-0057]
---

# SPEC-0064: PR-receipt check — release-pinned distribution and an npm-native pr-check

## Purpose

Adopters wire the CI presence check by pinning the reusable workflow at `@main` — a
moving branch on a personal repo, with no release gate. This spec does two things. **R1
(ship now):** move the adopter pin to `@latest`, a moving tag that tracks the newest
*published* release and is advanced automatically on every publish, so an org rollout
pins a release-gated ref instead of raw `main`. **R2–R4 (follow-up):** publish the
verdict as an `aireceipts pr-check` command so CI can run `npx aireceipts-cli@latest
pr-check` with no GitHub-repo `uses:` reference at all — the only packaging that removes
the personal-repo dependency entirely.

The check only ever *reads a PR's comments* for the marked receipt; generation stays on
the developer's machine (`npx aireceipts-cli pr --post`). This serves **I1/I4**
(local-first; zero transcript exposure on the runner) and the "one verdict, N packagings"
principle established with SPEC-0057: the verdict logic in `scripts/check-pr-receipt.mjs`
is the single source of truth behind the reusable workflow, the composite action
(SPEC-0057), and — with R2 — the published CLI.

## Requirements

- **R1** — A moving `latest` git tag tracks the newest published release. Caller
  templates (`docs/adopt/pr-receipt-check-caller.yml`, the `rollout-dogfood` generator,
  `docs/pr-receipts.md`, `aireceipts integrations`) pin the reusable workflow at
  `@latest`. `release-publish.yml`'s `tag-and-release` job force-moves `latest` to the
  published commit on every publish. The reusable workflow's *internal* self-checkout
  stays `ref: main` (freshest verdict script for this repo's own dogfood CI; the grep is
  backward-compatible by design).
- **R2** — An `aireceipts pr-check` command exposes the `check-pr-receipt.mjs` verdict
  (`found` / `missing-notice` / `missing-required`) through the published package. It
  accepts a comments JSON on stdin/path (CI passes the `gh api` output) with
  `--head-repo`, `--base-repo`, and `--require-same-repo` flags, mirroring the script's
  interface. Exit code is `0` for `found`/`missing-notice` and `1` for `missing-required`
  — the CLI never fails a build unless enforcement is opted in.
- **R3** — The render/native path (`@resvg/resvg-js`) is lazily imported so `pr-check`
  runs without loading it. A cold `npx aireceipts-cli@latest pr-check` in CI must not
  download or build native bindings it does not use.
- **R4** — A documented npm-native caller (`docs/adopt/`) runs the check via
  `npx aireceipts-cli@latest pr-check` with no `uses:` reference. `pr-check` also runs
  locally (a developer checks whether their PR carries a receipt before pushing).

## Scenarios

- **Given** an adopter repo pins `@latest`, **when** a new release publishes, **then**
  `release-publish.yml` moves `latest` to that commit and the adopter's next run resolves
  the release-gated workflow with no edit on their side.
- **Given** a PR carries the marked receipt comment, **when** `aireceipts pr-check` reads
  the comments JSON, **then** it prints `found` and exits `0`.
- **Given** a same-repo PR with no receipt and `--require-same-repo`, **when** `pr-check`
  runs, **then** it prints `missing-required` and exits `1`; a fork PR under the same flag
  stays `missing-notice`, exit `0`.
- **Given** a cold CI runner, **when** it runs `npx aireceipts-cli@latest pr-check`,
  **then** no `@resvg/resvg-js` native binary is fetched or built.

## Non-goals

- **Generating receipts in CI.** Generation stays local (I1/I4); the runner has no
  transcripts and does no pricing work. `pr-check` is a presence checker, never a renderer.
- **Replacing the reusable workflow or the SPEC-0057 composite action.** Three packagings
  of one verdict coexist; the adopter picks (reusable workflow / composite action for a
  GitHub-native `uses:` pin, npm CLI for a GitHub-repo-free pin). Reason: each fits a
  different adopter constraint and they share `check-pr-receipt.mjs`.
- **Changing the receipt marker or verdict semantics.** `DOGFOOD_MARKER` and the three
  verdicts are unchanged; R2 only re-packages them. The marker-parity test stays the gate.
- **SHA-pinning policy for adopters.** `@latest` is the documented default; adopters who
  want a frozen ref pin a `v*` tag. This spec does not mandate one over the other.

## Test matrix

| Req | Case | Input | Expected |
|---|---|---|---|
| R1 | Caller templates pinned | all live caller snippets | reference `@latest`, not `@main` |
| R1 | Release moves tag | `release-publish.yml` | a step force-moves `latest` to `${GITHUB_SHA}` |
| R1 | Internal ref unchanged | `pr-receipt-check.yml` | self-checkout stays `ref: main` |
| R2 | pr-check found | comments JSON with marker | stdout `found`, exit 0 |
| R2 | pr-check missing-notice | comments JSON, no marker, no enforce | stdout `missing-notice`, exit 0 |
| R2 | pr-check missing-required | no marker, `--require-same-repo`, same-repo | stdout `missing-required`, exit 1 |
| R3 | Lean check path | `pr-check` invocation | no `@resvg/resvg-js` import on the code path |
| R4 | npm-native caller | `npx aireceipts-cli@latest pr-check` | resolves with no `uses:` reference; same command runs locally |

## Success criteria

- [x] R1 landed: every live caller template pins `@latest`; `release-publish.yml` advances
      the tag; a bootstrap `latest` tag exists at the current release.
- [ ] R2–R4: `aireceipts pr-check` ships in `dist/`, verdict parity with
      `check-pr-receipt.mjs` is asserted by a test, and the render path stays lazy.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, `node scripts/spec-lint.mjs` all pass unmasked
      (`echo $?`).

**Shipped in v0.4.0:** R1 only (`@latest` pin + tag-move, #164). R2–R4 (the npm-native
`aireceipts pr-check` command) are not built; the spec stays `status: building` until they
land.
