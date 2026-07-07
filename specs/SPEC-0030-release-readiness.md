---
id: SPEC-0030
title: "Release readiness — rename to receipts, the why, and the org dogfood kit"
status: shipped
milestone: M4
depends: [SPEC-0029]
---

# SPEC-0030 · release readiness

Invariants: I1/I5 (README receipts stay guard-pinned through every edit),
I4 (the rollout kit adds no telemetry and runs nothing on CI that needs
transcripts), I3 (the why-section makes claims the docs already prove).

## Purpose

Maintainer direction (2026-07-03): before the public flip — (1) the repo
becomes `anandgupta42/receipts` (the binary and npm package stay
`aireceipts`); (2) the README must say what pain this addresses the moment
someone lands, briefly; (3) installation must be dead simple, documented,
and then dogfooded across the active repos of the maintainer's GitHub org.
Renaming pre-launch avoids permanent redirect debt: GitHub redirects
git/web URLs after a rename (raw resolves in practice; verify live), but
**Pages does not** — `anandgupta42.github.io/aireceipts/*`
dies, taking the hardcoded `VIEWER_URL`, the README badge/guide links, and
every artifact-viewer link already posted on PRs #63–68 with it. Total
hardcoded-URL surface measured before drafting: 7 occurrences across
`src/pr/publish.ts`, `README.md`, `site/index.html` (comment links
self-heal — `artifactViewUrl` derives owner/repo from the PR at post time).

**Kill criterion:** (a) the rename may only be executed (maintainer button)
inside the atomic window: the URL-update PR is green and ready, the rename
happens, the PR merges, Pages redeploys, and the five stale receipt
comments are re-posted — if any step in that window cannot complete, the
rename reverts the same day (GitHub allows rename-back; a half-renamed
public launch is the failure this criterion exists to prevent); (b) the org
rollout runs only AFTER v0.1.0 is on npm — a dogfood PR telling developers
to `npx aireceipts` before that command works is a credibility bug; the
rollout script hard-fails if `npm view aireceipts version` fails.

## Requirements

- **R1 — URL cutover, atomic with the rename.** One PR updates every
  hardcoded URL to the `receipts` repo name: `VIEWER_URL` in
  `src/pr/publish.ts`, the badge/guide/site links in `README.md` and
  `site/index.html`, plus a new `repository`/`homepage`/`bugs` block in
  `package.json` (npm publish surface; currently absent). The
  `aireceipts/artifacts` branch name does NOT change (it is
  product-namespaced by the binary; renaming it would break every already-
  posted raw link a second time). Sequencing recorded in the spec: PR
  green → maintainer renames the repo (Settings, their button) → merge →
  Pages redeploys → `aireceipts pr --post --artifact` re-run on PRs #63–68
  so their viewer links point at the new Pages path. Old github.com/git URLs redirect per GitHub's documented rename behavior;
  old raw URLs continue to resolve in practice (verify live inside the
  window — not documented as redirects); old Pages URLs are the one
  casualty, repaired by the re-posts in the same window.
- **R2 — The why, on landing.** A four-line "Why this exists" paragraph
  directly under the hero receipt (exact copy in Design), replacing the
  current one-line description: pain (agents spend real money invisibly) →
  what you get (session / PR / waste receipts) → the trust property (local,
  deterministic, nothing leaves the machine). Additionally a two-line
  **Related work** block near the docs links, crediting prior art
  generously (maintainer concern, 2026-07-03): `claude-receipts` (the
  thermal-printer art project for Claude Code sessions) and `ccusage`
  (its cost source) — different jobs, same good metaphor; the prepared
  positioning paragraph for launch threads is committed in
  `docs/internal/readme-evidence.md`. README guard budgets unchanged and
  still passing.
- **R3 — One-line adoption for any repo: the reusable workflow.**
  `.github/workflows/pr-receipt-check.yml` gains `workflow_call` so other
  repos adopt the receipt check with a 3-line caller instead of copying two
  files. The called job must `actions/checkout` THIS repo (public at
  rollout) to obtain `scripts/check-pr-receipt.mjs` — caller repos do not
  carry the script (the measured hole in the copy-two-files approach). The
  called workflow reads the PR number from the caller's `pull_request`
  event context and declares its minimal `permissions` explicitly. Two
  hard constraints, recorded because GitHub does NOT redirect reusable-
  workflow references after a rename: (a) callers reference
  `anandgupta42/receipts/...@main` and may only ever be created AFTER the
  rename; (b) the caller template is committed at
  `docs/adopt/pr-receipt-check-caller.yml`, and `docs/pr-receipts.md`'s
  maintainer section shrinks to: paste the caller, add the CONTRIBUTING
  line. The existing same-repo trigger keeps working unchanged.
- **R4 — The org dogfood rollout report (report-only, by design).**
  `scripts/rollout-dogfood.mjs` enumerates a private dogfood org's repos active in
  the last 90 days (pushed_at, non-archived, non-fork), notes which already
  carry the caller, and emits a per-repo adoption packet: the exact caller
  file content, the CONTRIBUTING line, and the copy-pasteable `gh` commands
  to open each PR. It performs ZERO writes — automated cross-repo PR
  creation is deliberately out (workflow-file writes need `workflow`-scope
  tokens and per-repo permissions; that auth surface is not worth
  automating until manual adoptions prove the caller). The report refuses
  to generate (kill criterion b) unless `npm view aireceipts version`
  succeeds — a packet telling developers to run an unpublished command is a
  credibility bug. Never run by CI.
- **R5 — Install documentation: one line per audience.**
  README Install stays `npx aireceipts` (+ the pre-release caveat until
  publish, then the caveat is deleted by the release flow); `docs/
  pr-receipts.md` maintainer section becomes the 3-line caller; a new short
  `docs/adopt/org-rollout.md` documents the R4 script for anyone running a
  fleet (public doc, a private dogfood org is just the first user).

## Design (lead-authored)

R2 copy, verbatim (guard-compliant: no emoji, no new links needed):

> **Why this exists.** AI coding agents spend real money invisibly — you
> see the diff, never the bill. aireceipts reads the transcripts your agent
> already writes to disk and turns them into receipts: what a session cost,
> tool by tool; what a PR cost, across every agent that built it; where
> tokens were wasted. Local and deterministic — no accounts, no servers,
> nothing leaves your machine.

R3 caller template, verbatim:

```yaml
name: pr-receipt-check
on: [pull_request]
jobs:
  check:
    uses: anandgupta42/receipts/.github/workflows/pr-receipt-check.yml@main
```

> **Superseded (SPEC-0064 R1):** callers now pin `@latest` — a moving tag that
> tracks the newest published release, advanced by `release-publish.yml` on every
> publish — instead of `@main`. The template above records what R3 originally
> shipped; the live template is `docs/adopt/pr-receipt-check-caller.yml`.

R1 sequencing checklist (maintainer + agent interleaved, executed as one
continuous window):
1. URL-cutover PR opened, CI green, held unmerged.
2. Maintainer: Settings → rename `aireceipts` → `receipts`.
3. Agent: merge the PR; wait for Pages deploy green; verify
   `anandgupta42.github.io/receipts/view.html` → 200.
4. Agent: re-post receipts on PRs #63–68 (`pr --post --artifact`).
5. Agent: verify one old raw URL redirects and one new viewer link renders
   (post-flip) or shows the honest private-repo error (pre-flip).

## Scenarios

- **Given** the rename window completes, **when** anyone opens an old
  `github.com/anandgupta42/aireceipts/...` link, **then** GitHub redirects;
  **and** the re-posted comments' viewer links point at
  `github.io/receipts/`.
- **Given** a repo adds the 3-line caller, **when** a PR has no receipt
  comment, **then** the check emits the neutral notice and never fails the
  build (existing behavior through `workflow_call`).
- **Given** `rollout-dogfood.mjs` without flags, **then** it prints the
  target-repo report and exact diffs, writes nothing.
- **Given** `--live` while `aireceipts` is not on npm, **then** it refuses
  with the kill-criterion message.

## Non-goals

- **Transferring the repo to the maintainer's private org** (maintainer decision:
  stays under `anandgupta42`).
- **Renaming the npm package or binary** — `aireceipts` everywhere in the
  product; only the repo name changes.
- **Renaming the `aireceipts/artifacts` branch** (would re-break posted
  links for zero benefit).
- **Auto-merging rollout PRs in org repos** — each repo's owners merge
  their own; the script only opens PRs.
- **The npm publish itself** — the existing `/release` flow and maintainer
  click; R4 merely gates on its result.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 no stale URLs | grep repo for `github.io/aireceipts` + `anandgupta42/aireceipts` | zero matches in src/docs/site/README/package.json |
| R1 viewer constant | `VIEWER_URL` | `…github.io/receipts/view.html`; artifactViewUrl unit tests updated |
| R1 npm fields | package.json | repository/homepage/bugs point at `receipts` |
| R2 why-section | README | Design copy present under hero; guard 9/9 still green |
| R3 workflow_call | pr-receipt-check.yml | `on:` includes `workflow_call`; same-repo trigger retained |
| R3 caller template | docs/adopt/pr-receipt-check-caller.yml | yaml body matches Design; explanatory header comments allowed |
| R1 artifact branch untouched | `ARTIFACT_BRANCH` | still `aireceipts/artifacts` |
| R3 called-workflow shape | pr-receipt-check.yml | workflow_call present; checks out anandgupta42/receipts; explicit permissions; reads caller PR context |
| R4 report-only | script under mocked gh runner | zero write-verb calls recorded |
| R4 publish gate | mocked missing npm version | refuses, names the gate |
| R4 idempotence | mocked repo already carrying caller | skipped with note |
| R4 enumeration filters | mocked repo list (archived/fork/stale) | excluded per rule |
| R2 related work | README | claude-receipts + ccusage credited |
| R5 caveat lifecycle | README install section | pre-release caveat present now; removal recorded as a release-flow step |
| R5 docs | pr-receipts.md + docs/adopt/org-rollout.md | 3-line caller shown; rollout doc exists |

## Success criteria

- [ ] The rename window (Design checklist) completes in one sitting; old
      raw/web URLs redirect; re-posted comments verified.
- [ ] Dry-run rollout report reviewed by the maintainer before any `--live`.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass
      unmasked (`echo $?`); README guard green after R2.

## Validation

**2026-07-03 · S1 (self):** every requirement checks from repo bytes or a
mocked runner except the rename itself and the live-window verifications,
which are recorded as an explicit maintainer+agent checklist with a revert
path. The two claims that needed external grounding were checked before
drafting: name availability (anandgupta42/receipts free) and the
hardcoded-URL inventory (7 occurrences, 3 files).

**2026-07-03 · S2 (Codex, read-only): REWORK → draft reworked.** Full output
captured to file this time. Findings and disposition:
1. HIGH — reusable-workflow callers lack `scripts/check-pr-receipt.mjs` —
   **accepted**; the called job now checks out this repo for the script.
2. HIGH — cross-org PR automation has workflow-scope/permission holes —
   **accepted**; R4 demoted to a report-only adoption packet, zero writes;
   automation deferred until manual adoptions prove the caller.
3. MEDIUM — raw-URL "redirect" overclaimed vs GitHub docs — **accepted**;
   rephrased to "resolves in practice, verify live in the window."
4. MEDIUM — GitHub does not redirect reusable-workflow references after
   rename — **accepted**; hard constraint recorded: callers are created
   only AFTER the rename, referencing `receipts` from birth.
5. MEDIUM — workflow_call test row too shallow — **accepted**; row now
   covers checkout-of-source-repo, explicit permissions, caller PR context.
6. MEDIUM — missing rows (artifact branch untouched, enumeration filters,
   caveat lifecycle, related-work) — **accepted**; rows added.
7. MEDIUM — success criteria omitted determinism + hygiene — **accepted**;
   full CI-identical block restored.
8. LOW — unmeasurable phrasing — **accepted**; softened or made checkable.
9/10. Scope-creep / cut-R4 — **accepted in substance** via the report-only
   demotion; the maintainer's org-dogfood directive is preserved as a paved
   path (packet + commands) rather than automation.

**2026-07-03 · S3 (value gate):** the rename's kill criterion has a live
revert path (GitHub rename-back) and the whole window was sized against the
measured 7-URL surface; the rollout gate (npm publish preflight) is testable
today — it fails, correctly, until v0.1.0 ships. Related-work requirement
grounded in the measured prior art (claude-receipts: 616 stars, thermal-
printer novelty over ccusage; verified by reading its README).

**2026-07-03 · S5 (PR A implementation review, Codex): REWORK → fixed.**
(2) "zero writes" claim overbroad (compile wrapper + npm/gh caches write
locally) — accepted; claim scoped to "no repo/GitHub mutations" everywhere
it appears, test renamed to what it proves. (3) HIGH — the prior-art copy
broke its own rules: "Infracost pioneered" was a priority claim (now
"does"), and the evidence note asserted state-of-mind as a defense (now an
instruction to answer truthfully once, with the git timestamp as the only
artifact). (4) caller template carries explanatory header comments — spec
row made precise rather than stripping useful comments. Earlier findings
truncated in capture were subsumed by (2).

**2026-07-03 · S4 (lint):** `node scripts/spec-lint.mjs` → 30 spec(s) OK,
exit 0.

**2026-07-03 · approved (button 1):** maintainer, in-session ("approved") after the hardened prior-art positioning round. Build split: PR A (R2/R4/R5 + caller template, mergeable now) and PR B (R1 cutover + R3 workflow_call, held green for the rename window). Positioning addendum: lineage framing (ccusage, claude-receipts, Infracost), committed reply paragraph, no independent-invention claims anywhere.

**2026-07-04 · shipped:** merged via #71 #72 (rename window executed 2026-07-04); ledger sweep pre-release.
