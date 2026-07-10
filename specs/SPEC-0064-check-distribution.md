---
id: SPEC-0064
title: PR-receipt check — release-pinned distribution and a self-contained npm-native pr-check
status: shipped
milestone: M5
depends: [SPEC-0019, SPEC-0030, SPEC-0057, SPEC-0066]
---

# SPEC-0064: PR-receipt check — release-pinned distribution and a self-contained npm-native pr-check

## Purpose

Today an adopter posts the PR receipt one of two ways: locally (`npx aireceipts-cli pr
--post` with their own `gh`), or by pinning aireceipts' **reusable workflow** via `uses:`.
The reusable-workflow path has friction that blocks a seamless org rollout: it is an
*external* workflow in a personal public repo, so an internal org repo can only call it if
the org's Actions policy permits public reusable workflows, self-hosted runners don't cross
to it, and a caller `@vX` pin does not actually freeze what runs (the workflow checks out
`main` + `@latest` internally).

**R1 (shipped in v0.4.0):** move the adopter pin to `@latest`. **R2–R7 (this spec):** ship
a **self-contained** `aireceipts pr-check` command so an adopter's *own* workflow — one job
running `npx -y aireceipts-cli@latest pr-check`, with **no reusable-workflow `uses:`** —
fetches the branch's receipt ref, renders + sanitizes it, upserts the marked PR comment via
`GITHUB_TOKEN`, and returns the presence verdict for optional enforcement. `npx` from public
npm is not a reusable workflow, so this removes the org-policy gate, the personal-repo
dependency, and the runner constraint at once.

The hard boundary is unchanged: **CI never generates a receipt** — the transcript lives only
on the developer's machine (I1/I4). `pr-check` only *transports* what the local hook
(SPEC-0065) produced on `refs/aireceipts/<slug>`: fetch → sanitize → render → post.

## Requirements

- **R1 (shipped)** — A moving `latest` git tag tracks the newest published release. Caller
  templates (`docs/adopt/pr-receipt-check-caller.yml`, the `rollout-dogfood` generator,
  `docs/pr-receipts.md`, `aireceipts integrations`) pin the reusable workflow at `@latest`;
  `release-publish.yml` force-moves `latest` on every publish; the reusable workflow's
  internal self-checkout stays `ref: main`.
- **R2 — `pr-check` is the self-contained CI entrypoint (fetch → render → post), no base
  checkout.** It creates a throwaway temp git repo (`git init` in an OS temp dir) and fetches
  `refs/aireceipts/<slug>` from the **head** repo via a token-authenticated URL
  (`https://x-access-token:<token>@github.com/<head-full-name>.git`), reusing SPEC-0066
  `fetchReceiptRef` — so no `actions/checkout` of the base repo is required. Context resolves
  from Actions env: base repo full name `GITHUB_REPOSITORY`; head repo full name + PR number
  from the `GITHUB_EVENT_PATH` payload (`pull_request.head.repo.full_name`,
  `pull_request.number`); head ref `GITHUB_HEAD_REF`. Flags override:
  `--pr`, `--base-repo`, `--head-repo` (**full name** `owner/repo`), `--head-ref`. The
  head-repo **full name** and the derived **clone URL** are kept distinct (full name for
  verdict/posting; URL, built with the token, only for the fetch). It renders + sanitizes via
  SPEC-0066 `fetchAndRenderReceipt` + the field-aware sanitizer, then **upserts the single
  `DOGFOOD_MARKER` comment** on the **base**-repo PR via a **new injected REST client**
  (`GITHUB_TOKEN`/`GH_TOKEN`, no local `gh`). The posted body is byte-identical to the two-job
  reusable workflow's output for the same payload.
- **R3 — the REST upsert is a small injected, paginated helper.** New `src/pr/` module (not
  the existing `gh`-based `comment.ts`, which shells out to `gh` and is unusable here):
  given base full name + PR number + token, it lists **all** comment pages, finds the first
  body starting with `DOGFOOD_MARKER`, and **creates** (POST) if absent or **PATCHes** the
  existing one — never a second marker comment. It classifies failures cleanly: a `403`
  (fork read-only token) or `404` degrades to a printed notice + no throw; other errors are
  reported best-effort. If posting fails, the command checks once more for an existing marker:
  an existing comment stays `found`, while an absent comment follows the notice/required policy
  below. The REST client is injected (a `fetch`-like dep) so tests mock it — **no live network
  in tests**.
- **R4 — verdict + enforcement + exit codes.** Reuses `receiptCheckVerdict` semantics:
  an attached marker comment (`found`) → exit 0; missing on default/fork → `missing-notice`,
  exit 0; missing on a
  **same-repo** PR with `--require-same-repo` (or `AIRECEIPTS_REQUIRE_PR_RECEIPT=true`) →
  `missing-required`, exit 1. Coarse same-repo-vs-fork only; agent-built vs hand-written stays
  **SPEC-0066 R5 (deferred)**. Fork PRs never fail (read-only token; no transcript on any
  runner). A valid ref whose comment cannot be attached is therefore required only in strict
  same-repo mode; it stays advisory for default/fork runs. `pr-check` also runs locally (a dev
  checks their branch carries a receipt).
- **R5 — lazy render + honest install cost.** `pr-check` never *loads* `@resvg/resvg-js` at
  runtime (markdown only; no SVG/PNG) and does not need the native binary to be functional.
  It does **not** claim to avoid *installing* it — `@resvg/resvg-js` stays a runtime dependency
  today (making it optional is a separate packaging change, out of scope). "Lean" here means
  the render code path, not the npm install footprint.
- **R6 — self-contained adopter workflow + template fix + honest trust model.** Ship
  `docs/adopt/pr-check-caller.yml`: `permissions: { contents: read, pull-requests: write }`,
  one job, `npx -y aireceipts-cli@latest pr-check`, no reusable-workflow `uses:` (a first-party
  `actions/checkout` step is *not needed* — `pr-check` self-fetches — and standard Actions like
  checkout are not the policy-gated "public reusable workflows"). Also fix
  `docs/adopt/pr-receipt-check-caller.yml` to add `pull-requests: write` — missing today, so a
  reusable-workflow adopter's post job silently cannot comment (a real bug, independent of this
  spec). The npm-native caller forwards `vars.AIRECEIPTS_REQUIRE_PR_RECEIPT` and only uses
  `continue-on-error` while that variable is not exactly `true` or the PR is from a fork,
  preserving notice-only/fork behavior while making same-repo opt-in enforcement effective.
  **Trust model (honest):** the single-job
  path renders the untrusted, fork-author-
  controlled payload in the same job that holds the write token. The sanitizer
  (`src/pr/sanitize.ts`) is a **Markdown-safety** barrier only — it does **not** isolate the
  token from a package/runtime compromise, and does **not** prove the receipt's dollar
  provenance (that is the receipt's own I2/I3 discipline). So `pr-check` is for **trusted
  same-repo / internal** PRs; the **two-job reusable workflow (SPEC-0066)**, which renders
  token-lessly, stays the defense-in-depth path for **untrusted fork** PRs.
- **R7 — hidden CI command + determinism + tests.** `pr-check` is a **hidden** command,
  exactly like its sibling `pr-render-ref` — not in `--help`, so no help golden changes. It is
  **telemetry-silent** by the same precedent: `pr-render-ref` is not in `COMMAND_VALUES` and
  neither is `pr-check`; telemetry is auto-off in CI anyway, and a local run is uncounted just
  as `pr-render-ref`'s is. It is **transport, not generation** (no `receipt_generated`).
  Documented in `docs/adopt/` and `docs/pr-receipts.md`, not the interactive help. The
  comment-marker and two-job paths are unchanged; `pr-check` is additive. Tests: context
  resolution (env vs flags, incl. a fork whose head-repo ≠ base); temp-repo fetch; verdict +
  exit codes (found / notice / required / fork); REST upsert create-vs-update + 403/404
  classification against a **mocked** client (no live network); posted body ==
  `renderPrBody(sanitized)` byte-for-byte; hostile-payload sanitize; lazy-render assertion.
  `verify-goldens`, the sanitizer injection golden, and existing `pr-receipt-check` tests stay
  green.

## Scenarios

- **Given** an internal repo with the self-contained `pr-check` workflow and a branch carrying
  a receipt ref, **when** a same-repo PR opens, **then** `pr-check` self-inits a temp repo,
  fetches the ref from the head repo with the token, posts the marked comment on the PR, and
  exits 0 — no `uses:`, no org Actions-policy toggle, no local `gh`, no base checkout.
- **Given** the PR re-runs after new pushes, **when** `pr-check` runs again, **then** it
  PATCHes the one marker comment (paginated lookup finds it) — no duplicate.
- **Given** a hostile payload on the ref, **when** `pr-check` renders it, **then** the
  sanitizer neutralizes it; the posted comment never breaks out; the job never throws.
- **Given** a fork PR (read-only token) with no receipt and enforcement on, **when** `pr-check`
  runs, **then** a `403` on post degrades to a notice, verdict is `missing-notice`, exit 0.
- **Given** a same-repo PR with no receipt and `AIRECEIPTS_REQUIRE_PR_RECEIPT=true`, **when**
  `pr-check` runs, **then** exit 1, `missing-required`.
- **Given** a same-repo PR with a valid ref but a failed comment POST/PATCH and no existing
  marker, **when** enforcement is on, **then** exit 1, `missing-required`; notice-only and fork
  runs remain advisory.

## Non-goals

- **Generating receipts in CI.** No transcript on the runner (I1/I4); `pr-check` transports
  the ref, never prices or renders from a transcript.
- **Replacing the two-job reusable workflow.** It stays the hardened path for untrusted **fork**
  PRs (token-less render). `pr-check` is the self-contained packaging for trusted (same-repo /
  internal) PRs and local checks; both share SPEC-0066 fetch/sanitize/render code.
- **Overloading `pr-render-ref`.** That command is the explicit token-less render entrypoint;
  `pr-check` is a separate, additive command, not a `--post` flag on it.
- **Removing `@resvg/resvg-js` from the install / agent-built enforcement / marker or schema
  changes.** Out of scope (the latter two are SPEC-0066 / unchanged).

## Test matrix

| Req | Case | Input | Expected |
|---|---|---|---|
| R1 | Caller templates pinned | live caller snippets | `@latest`, not `@main` (shipped) |
| R2 | context from env | Actions env only | base/head full names, PR #, head ref resolved |
| R2 | flags override env | `--pr`/`--base-repo`/`--head-repo`/`--head-ref` | flags win |
| R2 | fork head ≠ base | event payload with fork head repo | fetch targets head clone URL; verdict uses full names |
| R2 | temp-repo fetch | no base checkout | temp `git init` + token URL fetch succeeds |
| R2 | body parity | valid ref payload | posted body == `renderPrBody(sanitized)` byte-for-byte |
| R3 | upsert create | no marker comment (paginated) | one marker comment POSTed |
| R3 | upsert update | existing marker comment | that comment PATCHed; no duplicate |
| R3 | 403/404 classify | fork read-only token / missing | notice, no throw, no comment |
| R4 | found / notice / required / fork | marker/ref/post result × repo relation | exit 0/0/1/0 with matching verdict; strict post failure fails if no marker remains |
| R5 | lazy path | `pr-check` invocation | `@resvg/resvg-js` not loaded at runtime |
| R6 | caller templates | `pr-check-caller.yml` + reusable caller | both declare `pull-requests: write`; pr-check caller has no reusable `uses:` and forwards conditional enforcement |
| R7 | hidden command | `--help` output | `pr-check` absent (hidden, like `pr-render-ref`); help golden unchanged |
| R7 | hostile payload / back-compat | injection corpus; existing tests | sanitized, no throw; comment-marker + two-job paths unchanged |

## Success criteria

- [x] R1 landed: every live caller template pins `@latest`; `release-publish.yml` advances the
      tag; a bootstrap `latest` tag exists at the current release.
- [x] R2–R6: `aireceipts pr-check` ships in `dist/` and, in a self-contained workflow (no
      reusable `uses:`, no base checkout), fetches the ref, upserts the marked comment via
      `GITHUB_TOKEN`, and returns the verdict; render path lazy; reusable-caller permission bug
      fixed; trust model documented.
- [x] R7: telemetry enum + docs + parity; body-parity, upsert create/update + 403/404 (mocked),
      verdict/exit-code, and hostile-payload tests pass; `verify-goldens` and existing
      `pr-receipt-check` tests stay green.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, `node scripts/spec-lint.mjs` all pass unmasked.

**Shipped:** R1 in v0.4.0 (`@latest` pin + tag-move, #164); R2–R7 in v0.5.0 (the self-contained
npm-native `pr-check` that fetches + renders + posts + verdicts, #176). Spec fully `shipped`.
