---
id: SPEC-0066
title: CI renders and posts PR receipts from the ref (the trust boundary)
status: approved
milestone: M5
depends: [SPEC-0019, SPEC-0064, SPEC-0065]
---

# SPEC-0066: CI renders and posts PR receipts from the ref (the trust boundary)

## Purpose

SPEC-0065 makes a receipt travel with the branch as `refs/receipts/<slug>`, generated
locally. This spec is the other half: CI fetches that ref, and — instead of the developer
running `pr --post` with local `gh` — **CI itself renders and posts the PR comment** via
`GITHUB_TOKEN`, so a receipt lands with zero manual action. It is carved out of SPEC-0065
because it crosses a new trust boundary: the ref payload is **fork/branch-author-controlled
input**, and CI now posts derived content with a write token. That demands its own schema
validation + Markdown-injection review, kept out of the low-risk local producer. Generation
still never happens on the runner (I1/I4) — CI only validates, sanitizes, renders, and
transports what the local hook produced.

## Requirements

- **R1 — locate + fetch order.** `pr-receipt-check.yml` / `scripts/check-pr-receipt.mjs`:
  existing comment marker (back-compat, wins) → `git fetch <remote>
  +refs/receipts/<slug>:refs/receipts/<slug>` then read `receipt.json`. Fork PRs fetch from
  the head-repo clone URL; on failure, fall through to the current missing-receipt path.
  `slug` comes from SPEC-0065's shared `receiptRefSlug`.
- **R2 — validate the untrusted payload.** Parse the blob as `PrReceiptPayload`
  (SPEC-0065), assert a known `schemaVersion`, reject unknown fields, non-finite numbers,
  and over-cap strings. Any validation failure is treated exactly as **missing** (quiet or
  enforced per R5) — CI never posts an unvalidated payload, never throws on hostile input.
- **R3 — sanitize, then render (injection defense).** Every string reaching the comment
  from the payload is untrusted (`DetailReceipt.text` is pre-rendered Markdown; `label`,
  `row` cells, model names, waste lines are attacker-influenceable). Before render: guard
  code fences (an injected ` ``` ` must not break out of the receipt fence — use a
  length-adaptive fence or escape), neutralize raw HTML / `<details>` control tags, defang
  Markdown links to plain text, and enforce the existing `COMMENT_SIZE_CAP`. Then feed the
  sanitized payload to the unchanged `renderPrBody`. A golden pins the sanitizer against a
  corpus of injection vectors. **Load-bearing render constraint (verified against
  `body.ts`):** subagent names (`SubagentRow.name` = the prompt-derived subagent title,
  attacker-controlled) reach the comment ONLY via the pre-rendered
  `extras.details[].subagents` string. CI MUST render through `renderPrBody(sanitizedPayload)`
  and rely on that sanitized string — it must NEVER regenerate the subagent table from
  `bodyInput.contributors[].subagents` raw rows, or the raw `name` bypasses the sanitizer.
  (`bodyInput.contributors[].subagents` legitimately feeds only count/cost math.)
- **R4 — CI posts via `GITHUB_TOKEN`.** The reusable workflow `permissions` gains
  `pull-requests: write`; CI upserts the marked comment (create/update the one marker
  comment, no spam). The developer needs no local `gh`. `contents: read` and
  `id-token`/`attestations` are NOT added (no signing here).
- **R5 — enforcement, opt-in and honest.** With `AIRECEIPTS_REQUIRE_PR_RECEIPT=true`, an
  **agent-built** (agent `Co-Authored-By` trailer or receipt-attach commit) **same-repo** PR
  with a missing/invalid receipt fails the check with a 2-step fix comment. Hand-written PRs
  (no agent evidence) and fork PRs never fail — there is no transcript to require.
  Default stays notice-only.
- **R6 — determinism + back-compat.** The comment-marker path is unchanged; the ref path is
  additive. The same payload renders the same comment bytes; the sanitizer is golden-gated;
  `verify-goldens` and existing `pr-receipt-check` tests stay green.

## Scenarios

- **Given** a branch carrying a valid receipt ref, **when** CI runs, **then** it fetches,
  validates, sanitizes, renders, and upserts the marked comment via `GITHUB_TOKEN`; the
  check is green and the developer ran no `pr --post`.
- **Given** a hostile payload (injected fence / `<details>` / link / `NaN` / unknown
  field), **when** CI processes it, **then** validation rejects or the sanitizer neutralizes
  it — no comment breakout, no thrown job.
- **Given** an agent-built same-repo PR with no receipt and enforcement on, **when** CI
  runs, **then** it fails with the 2-step setup comment.
- **Given** a hand-written PR (no agent evidence) with no receipt, **when** CI runs, **then**
  it never fails, even with enforcement on.

## Non-goals

- **Generating a receipt in CI.** No transcript on the runner (I1/I4); CI validates +
  transports only.
- **Changing the producer or the ref layout.** Those are SPEC-0065; this spec consumes the
  `PrReceiptPayload` seam unchanged.
- **Sigstore signing / attestation.** A separate provenance layer, out of scope; no
  signing permissions are added.
- **Replacing the comment marker path.** The existing comment-presence check stays as the
  back-compat/first-match; the ref path is additive.

## Test matrix

| Req | Case | Input | Expected |
|---|---|---|---|
| R1 | locate order | comment + ref both present | comment wins; no double-post |
| R1 | ref fetch (same-repo) | ref on origin | fetched + read |
| R1 | fork fetch fail | ref only on head repo, unreachable | degrades to missing path, no throw |
| R2 | bad schemaVersion | payload with unknown version | treated as missing; nothing posted |
| R2 | unknown field / NaN | malformed payload | rejected as missing; job green |
| R3 | fence breakout | `DetailReceipt.text` with ` ``` ` | escaped/guarded; receipt fence intact |
| R3 | HTML / details inject | payload string with `<details>`/`<script>` | neutralized in the posted comment |
| R3 | valid render parity | clean payload | posted comment == `renderPrBody` byte-for-byte |
| R4 | write permission | reusable workflow | declares `pull-requests: write`; upserts one marked comment |
| R5 | enforce agent PR | agent trailer, no receipt, require on | fail + 2-step comment |
| R5 | hand-written PR | no agent evidence, require on | never fails |
| R6 | back-compat | comment-marker path unchanged | existing `pr-receipt-check` tests green; ref path additive |

## Success criteria

- [ ] CI fetches, validates, sanitizes, renders, and posts from the ref via `GITHUB_TOKEN`;
      no local `gh` needed.
- [ ] Injection corpus golden passes; hostile payloads never break the comment or fail the
      job unexpectedly.
- [ ] Enforcement is opt-in and skips hand-written/fork PRs.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, `node scripts/spec-lint.mjs` all pass unmasked.
