---
id: SPEC-0065
title: Seamless PR receipts — pre-push hook, store=ref, CI posts from the ref
status: building
milestone: M5
depends: [SPEC-0019, SPEC-0037, SPEC-0064]
---

# SPEC-0065: Seamless PR receipts — pre-push hook, store=ref, CI posts from the ref

## Purpose

Today a receipt reaches a PR only if a human/agent remembers to run `npx aireceipts-cli
pr --post` with local `gh` auth. If they forget, the PR has no receipt — the exact miss
the org rollout can't tolerate. This spec makes the receipt **attach itself**: a
committed pre-push git hook generates it locally and stores it as a git ref
(`refs/receipts/<slug>`) that travels with the push; CI reads the ref and renders + posts
the PR comment itself (no dev `gh` auth), enforcing presence when a repo opts in.

The hard boundary is unchanged and load-bearing: **CI never generates a receipt** — the
transcript lives only on the developer's machine (I1/I4). CI only transports and renders
what the local hook already produced. The pattern is proven in a sibling internal build
(`store=ref`); this ports it to aireceipts with byte-identical receipts (I1/I5): the
ref's wrapping commit is dated from the session's own `endedAt`, never wall-clock, so the
same transcript yields the same object SHA.

## Requirements

- **R1 — `store=ref` producer + stored payload schema.** `src/pr/store.ts` writes a
  **schema-versioned PR-receipt payload** — NOT the single-session `toJsonModel()` export,
  which carries no way to rebuild the comment (Codex plan-review, BLOCKER). The payload is
  the exact renderer input, all already JSON-plain data:
  `PrReceiptPayload = { schemaVersion: number; bodyInput: PrBodyInput; extras: PrBodyExtras }`
  (`src/pr/body.ts`). `store.ts` owns `serializePrReceipt` (JSON) / `deserializePrReceipt`
  (parse + schema-validate) as the round-trip; feeding the deserialized payload to the
  existing `renderPrBody` must reproduce the comment byte-for-byte. **String fields inside
  the payload stay untrusted across the CI trust boundary — sanitizing them at render time
  is SPEC-0066's job, not the producer's.** It is written as a git object on `refs/receipts/<slug>` via pure plumbing
  (`hash-object -w` → `mktree` with one `receipt.json` → `commit-tree` → `update-ref`),
  touching no index or worktree, through a **dedicated fixed-env git invocation** (the
  existing `CommandRunner` has no env seam): `GIT_AUTHOR_*`/`GIT_COMMITTER_*` pinned to a
  fixed identity, date `<epochSeconds> +0000` (explicit UTC), fixed commit message, single
  tree entry. The commit date is derived deterministically from the receipt model —
  `max(startedAtMs + durationMs)` across contributing sessions — both are optional on
  `ReceiptModel`, so the derivation skips any model missing either field and falls to `0`
  (epoch, clamped ≥ 1) when none qualify; never wall-clock, so it stays deterministic. `slug` comes from a **new shared
  `receiptRefSlug(branch)` helper** used identically by CLI, hook, and CI (there is no
  existing branch-slug helper to reuse). Surfaced as `aireceipts pr --store ref` and
  `AIRECEIPTS_STORE=ref`; default stays `comment` (opt-in first).
- **R2 — pre-push hook.** `.githooks/pre-push` acts only on a branch push (guards on
  `refs/heads/*` from stdin), runs `aireceipts pr --store ref`, then pushes the ref
  (`git push <remote> +refs/receipts/<slug>:refs/receipts/<slug>`). The nested ref push
  carries no `refs/heads/*`, so the same branch guard prevents recursion — **no
  commit-then-re-push dance, no second `git push` for the user.** Every failure path is
  best-effort: no session, not a repo, or push failure ⇒ one stderr line, the branch push
  proceeds. It never blocks a push.
- **R3 — repo-level activation, not per-user.** `package.json` `prepare` runs
  `git config core.hooksPath .githooks` (activates on `npm install` for this repo's
  contributors). The store default is repo-settable in a committed file
  (`.claude/settings.json` env `AIRECEIPTS_STORE=ref`); precedence: flag > process env >
  committed settings > default (`comment`). **Honest limit documented:** git never
  auto-runs fetched hooks, so non-`npm install` adopters need a one-line
  `git config core.hooksPath .githooks` (or the CI-only path) — CI (R4) is the only
  universal, install-free layer.
- **R4 — CI consumer: split to SPEC-0066 (the trust boundary).** The CI side — fetch
  `refs/receipts/<slug>`, validate the **untrusted, fork-author-controlled** payload against
  its `schemaVersion`, sanitize every string field (neutralize code fences, Markdown links,
  HTML `<details>`; reject non-finite numbers, cap lengths, reject unknown fields), render
  through the hardened renderer, upsert via `GITHUB_TOKEN` (workflow gains
  `pull-requests: write`), and opt-in enforce — is specified and built in **SPEC-0066**,
  which carries its own injection/security review. SPEC-0065 ships the producer, hook, and
  local tooling (R1–R3, R6; R5 is deferred — see the shipped/deferred note under Success
  criteria); the ref R1 writes is SPEC-0066's input, and the payload
  round-trip contract (`PrReceiptPayload`) is the seam both sides build to. The matrix rows
  below state that seam contract; their CI-side verification lives in SPEC-0066.
- **R5 — local tooling reads refs.** `aireceipts --list` / `week` / `stats` include
  ref-stored receipts (`git for-each-ref refs/receipts`) alongside file/session discovery;
  a prune deletes local+remote receipt refs for merged/gone branches.
- **R6 — determinism + tests.** Same transcript ⇒ same object bytes (dated from
  `endedAt`). Tests: plumbing round-trip (write ref → read back byte-identical); hook
  branch-guard + recursion guard; store precedence chain; CI locate order (comment beats
  ref; ref-only; neither); fork-fetch degrade; determinism-check stays green.

## Scenarios

- **Given** `AIRECEIPTS_STORE=ref` and a matching session, **when** the developer runs
  `git push`, **then** the pre-push hook writes and pushes `refs/receipts/<slug>` and the
  branch push completes with no second push.
- **Given** a PR whose branch carries a receipt ref, **when** CI runs, **then** it fetches
  the ref, renders the comment from it, upserts the marked comment via `GITHUB_TOKEN`, and
  the check is green — the developer ran no `pr --post` and needed no `gh`.
- **Given** an agent-built same-repo PR with no receipt (ref or comment) and enforcement
  on, **when** CI runs, **then** it fails with a comment showing the one-time hook setup.
- **Given** the same transcript on two machines, **when** each writes the ref, **then**
  the `receipt.json` blob and wrapping-commit SHA are identical (I1/I5).

## Non-goals

- **Generating receipts in CI.** Impossible and unwanted — no transcript on the runner
  (I1/I4). CI transports + renders only. Enforcement announces a miss; it can't fill it.
- **Flipping the default to `ref`.** Ships opt-in; a default flip is a later spec after
  dogfooding, so existing comment-based adopters are untouched.
- **Sigstore signing / attestation.** The sibling build signs the ref bytes; that is a
  separate provenance layer, out of scope here (the receipt's honesty rules stand alone).
- **Zero-setup hooks for arbitrary repos.** Git won't auto-run fetched hooks; R3 states
  the one-line activation for non-`npm` repos rather than pretending it's automatic.
- **Replacing the PR comment as the human surface.** The comment stays; R4 only changes
  who posts it (CI, from the ref) and removes the local-`gh` requirement.

## Test matrix

| Req | Case | Input | Expected |
|---|---|---|---|
| R1 | payload round-trip | `serialize` → `deserialize` → render | comment byte-identical to direct render |
| R1 | ref round-trip | payload write → read | `readReceiptRef` returns byte-identical bytes |
| R1 | deterministic SHA | same payload+derived date, pinned identity/tz | identical commit SHA across runs/machines |
| R1 | derived date | model with startedAtMs+durationMs | date = `max(startedAtMs+durationMs)`, no wall-clock |
| R1 | slug edges | branch names with `/`, spaces, unicode, empty | `receiptRefSlug` stable, matches CI's slug |
| R2 | branch-push triggers | stdin has `refs/heads/x` | runs producer, pushes ref, exit 0 |
| R2 | ref-push no recursion | stdin has only `refs/receipts/x` | guard exits 0, no regen |
| R2 | multi-ref / `--all` push | stdin has heads + other refs | acts once on the branch, explicit refspec only |
| R2 | no session | producer non-zero | push proceeds, one stderr line |
| R3 | precedence | flag vs env vs settings | flag > env > settings > `comment` |
| R4 | locate order | comment present + ref present | comment wins (back-compat) |
| R4 | ref-only | no comment, ref present | CI validates + renders + upserts, check green |
| R4 | untrusted payload | ref JSON with fences/links/`<details>`/NaN/unknown fields | schema-rejected or escaped; no raw injection posted |
| R4 | write permission | reusable workflow | declares `pull-requests: write`; posts via `GITHUB_TOKEN` |
| R4 | enforce miss | agent PR, no receipt, require on | check fails + fix comment |
| R5 | list refs | `for-each-ref refs/receipts` | ref receipts appear in `--list` |
| R6 | determinism gate | same transcript, 10 runs | `determinism-check` byte-identical; goldens green |

## Success criteria

- [x] R1 ref store + `--store ref` shipped with round-trip + determinism tests; default
      unchanged; `verify-goldens` and `determinism-check` green.
- [x] R2 pre-push hook + R3 activation land; recursion guard tested.
- [x] R4 CI renders + posts from the ref (no dev `gh`); enforcement opt-in; fork PRs stay
      notice-only. (The agent-built vs hand-written enforcement refinement is deferred with
      SPEC-0066 — see its note.)
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, `node scripts/spec-lint.mjs` all pass unmasked.
- [ ] R5 local tooling reads ref receipts (`--list`/`week`/`stats`) + a prune for merged
      branches — **not yet wired** (the spec stays `building` for this); the seamless
      push→CI-post arc (R1–R4/R6) does not depend on it.

**Shipped in v0.4.0:** the push→CI-post arc — R1 (`store=ref` producer), R2 (pre-push
hook), R3 (activation), R6 (determinism), and R4 via SPEC-0066. **Deferred:** R5 (local
`--list`/`week`/`stats` reading `refs/receipts` + a prune for merged branches) is not yet
wired — `listReceiptRefs` has no CLI caller. Also deferred with SPEC-0066: enforcement's
agent-built vs hand-written discrimination (opt-in enforcement is currently coarse —
same-repo vs fork only). Both are follow-ups; neither gates the seamless push→CI-post arc.
