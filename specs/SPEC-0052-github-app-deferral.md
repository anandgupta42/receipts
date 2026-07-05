---
id: SPEC-0052
title: GitHub App — defer; record the revisit triggers
status: rejected
milestone: M5
depends: [SPEC-0036]
---

## Tombstone

**Parked 2026-07-05 — worth gate (S3): defer, by design.** This spec was drafted as a
deferral record, and the validation pipeline confirmed the deferral is the whole value:
there is no build here. A hosted GitHub App conflicts with I1/I4 and the just-shipped
SPEC-0048 positioning ("local and deterministic — no accounts, no servers"), it can
never generate a receipt (transcripts live on the developer's machine — SPEC-0036 R4),
and its three unique values are all adoption-multiplied with no adoption evidence yet.
The code is **already bot-ready with zero changes**: comment selection matches the
marker prefix only, never the author (`src/pr/comment.ts:74-90`,
`scripts/check-pr-receipt.mjs:23`), so a future bot identity can take over the same
marked comment.

**Revive when any of these becomes true, and not before:**
1. An external org asks for receipt enforcement across many repos and rejects the
   per-repo workflow (`.github/workflows/pr-receipt-check.yml`) as the mechanism.
2. The commercialization track commits to a hosted org-aggregation product — the App is
   then its delivery vehicle, specced as part of that product, amending SPEC-0000 I4
   first with maintainer approval.
3. Fork-PR contributors measurably lose receipts because the copy-paste fallback
   (`docs/pr-receipts.md`) fails on real external PRs.

**Optional spec-free hygiene** (S2's "smaller fix" — maintainer's call, no spec
needed): two regression tests pinning author-agnostic comment selection
(`user.login` noise through `upsertPrComment` and `check-pr-receipt.mjs`), and one
FAQ sentence in `docs/pr-receipts.md` ("no bot; local by design"). **Maintainer TODO**
(external, untestable, deliberately not a requirement): register a placeholder
`aireceipts` GitHub App (webhook inactive, zero permissions, zero installs) to
reserve the global App name and the `aireceipts[bot]` login.

**Do NOT build** (`status: rejected` — `build-spec` gates on `approved`). The
requirements below are preserved as the record of exactly what was considered.

---

# SPEC-0052 · GitHub App — defer; record the revisit triggers

Invariants: I1/I4 (no server, no network in the product path — an App is a hosted
webhook service and is exactly what these invariants exclude), I5 (the comment marker
stays the stable contract a future bot would inherit), I6 (an App would check presence,
never judge quality).

## Purpose

The GitHub App question was raised by the maintainer (2026-07-05, M5 planning): should
aireceipts ship a hosted App, and if not now, when? This spec is the decision record.

What an App would uniquely add over today's `pr --post` + `gh` + notice-only CI
(SPEC-0036): a branded `aireceipts[bot]` comment identity, org-wide presence checks
without a per-repo workflow file, and a hosted aggregation surface (org cost
dashboards). What it can never add: receipt generation — transcripts live on the
developer's machine (SPEC-0036 R4); an App sees the PR, never the sessions that built
it.

Why not now: SPEC-0000 I1/I4 and the SPEC-0048 positioning were just shipped as the
product's sharpest differentiator. A webhook service means hosting, a private key,
uptime, and a security story — operational weight whose payoff scales with external
adoption, of which there is no evidence yet (the product launched days ago).

## Requirements

- **R1 — Deferral is the decision, not an omission.** No GitHub App, webhook service,
  or hosted component ships in M5. Any future spec that introduces one must amend
  SPEC-0000 I4 first with maintainer approval (SPEC-0000 success criteria already
  require this) and must cite this spec's Tombstone triggers.
- **R2 — Revisit triggers are explicit.** The three conditions in the Tombstone; the
  App question reopens when one holds, and not before.
- **R3 — Comment selection stays author-agnostic.** The upsert lookup matches the
  marked comment by body prefix only (`src/pr/comment.ts:74-90`) and the CI check does
  the same (`scripts/check-pr-receipt.mjs:23`); neither may ever filter on comment
  author. This is the property that lets a future App PATCH the same comment a human's
  `gh` created, with zero CLI change — and it already holds in shipped code (verified
  2026-07-05; `findMarkerCommentId` reads only `id`/`body`).
- **R4 — The decision is discoverable.** A future reader asking "why isn't this a
  bot?" finds the answer: this spec, linked from wherever the question next surfaces.

No SPEC-0043 telemetry events: this spec adds no runtime feature surface.

## Scenarios

- **Given** a PR whose marked comment was created by user `alice`, **when**
  `upsertPrComment` runs under a different identity, **then** it finds the comment by
  marker prefix and PATCHes it by id — author never consulted (R3).
- **Given** a future proposal to build the App, **when** none of the Tombstone
  triggers holds, **then** the proposal is declined by citing this spec (R1, R2).
- **Given** a Tombstone trigger fires, **when** the App is re-specced, **then** the
  new spec amends SPEC-0000 I4 first and verifies the design assumption below against
  the live API (R1).

## Non-goals

- **Building the App, in any form** — no webhook receiver, no Checks API integration,
  no bot posting path, no org dashboard. Reason: I1/I4, and the value is
  adoption-multiplied (see Purpose).
- **Renaming the marker.** `<!-- aireceipts-dogfood -->` (`src/pr/body.ts:22`) reads
  dogfood-specific, but it is the shipped stable contract (SPEC-0036) present on every
  existing PR; renaming breaks upsert continuity for zero user value.
- **App-name registration as a requirement.** It is a one-time manual web action,
  external to the repo and untestable in CI — recorded as a maintainer TODO in the
  Tombstone, not spec acceptance (S2 finding, accepted).
- **A CI bot comment that nags for missing receipts.** Already rejected in SPEC-0036
  non-goals; nothing here changes that.
- **Deciding the commercialization question.** Trigger 2 references it; the hosted
  product gets its own spec if and when that track commits.

## Design assumption to verify at build time (future spec)

A GitHub App with `issues: write` on a repo can PATCH issue comments it did not author
(the same repo-write permission that lets maintainers edit comments in the UI). R3's
author-agnostic selection makes takeover a pure identity swap **if** that holds. The
future App spec must verify this against the live API before promising comment
continuity; if it fails, the fallback is: the bot creates its own marked comment and
the marker-prefix match still yields one receipt comment per identity.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 no server surface | the diff landing this spec | spec file only — no webhook/server code, no new deps, no new network calls |
| R2 triggers named | this spec's Tombstone | all three revisit triggers present and concrete |
| R3 upsert ignores author | comments JSON: marked body with `user.login: "alice"` | comment id returned, PATCH path taken |
| R3 CI check ignores author | marked comment by human + unmarked comment by a bot | `found` |
| R4 discoverable | `ls specs/` | this file, status `rejected`, Tombstone intact |

## Success criteria

- [x] The deferral decision, its reasons, and the three revisit triggers are recorded
      in a spec that survives `spec-lint`.
- [x] The comment-selection contract was audited and confirmed author-agnostic in
      shipped code — no code change required.
- [ ] Maintainer acknowledges the Tombstone (parked, not a build candidate) and the
      optional spec-free hygiene items.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`) — trivially, as
      this change is a spec file only.

## Validation

**2026-07-05 · S1 (self):** No dollar claims, no rankings, no product-path network.
Every code claim grounded and re-verified live: marker at `src/pr/body.ts:22`,
author-blind selection at `src/pr/comment.ts:74-90` (`RawComment` carries only
`id`/`body`) and `scripts/check-pr-receipt.mjs:23`. The one unverifiable-locally claim
(App PATCH permission on others' comments) is explicitly quarantined as a build-time
assumption for the future spec, not a promise here.

**2026-07-05 · S2 (Codex, read-only): REWORK → reworked.** Findings and disposition:
1. ACCEPTED (cut) — R4 (App registration) was manual, externally stateful, untestable,
   and contradicted the deferral → demoted to a maintainer TODO in the Tombstone.
2. ACCEPTED — ungrounded Purpose claims ("keeps coming up", "multiply zero") →
   replaced with the concrete provenance (maintainer question, 2026-07-05) and "no
   adoption evidence yet".
3. ACCEPTED — commercialization strategy is not this spec's scope → reduced to trigger
   2, one line.
4. ACCEPTED — live-API permission research belongs in the future App spec → kept only
   as a labeled build-time assumption.
5. REJECTED — "R2 row checks only that trigger text exists, not evidence thresholds":
   triggers are revisit conditions in a decision record, not runtime behavior;
   formalizing evidence thresholds now is the exact governance machinery the same
   review flagged as creep.
6. NOTED — S2's worth attack ("don't build as written; keep two tests + one docs
   sentence") is adopted as the S3 verdict below; SPEC-0036's own stale
   `body.ts:337-366` citation (now `body.ts:461`) is out of scope here.

**2026-07-05 · S3 (worth gate): verdict — defer (parked).** Who + how often: the
motivating case is one maintainer strategy question during M5 planning — a one-off,
not a recurring user need; no external org, fork contributor, or buyer has asked for
an App. Do-nothing: perfectly acceptable — `pr --post` works, CI checks presence, and
the code is already author-agnostic, so deferral forecloses nothing. Smaller fix: two
regression tests + one FAQ sentence (recorded in the Tombstone as optional spec-free
hygiene). Steelman for not even keeping the record: "a spec that ships nothing is
process noise" — countered by this repo's own pattern (SPEC-0046): parked specs with
Tombstones are the cheap mechanism that stops re-litigation, and the S3 gate exists
because worth questions recur. The record IS the deliverable; the build is correctly
zero.

**2026-07-05 · S4 (lint):** `node scripts/spec-lint.mjs specs/SPEC-0052-*.md` → OK
(re-run after restructure, below).

Parked per S3 — not a build candidate. Button 1 here means acknowledging the
Tombstone, not approving a build.
