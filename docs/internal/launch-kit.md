# Launch kit — Show HN (maintainer's button; drafts, not autopilot)

Evidence base: `docs/internal/readme-evidence.md` (corpus + studies) and
`docs/internal/readme-evidence.md` §prior-art. Nothing here auto-posts.

## Title (pick one; corpus: plain register beats hype, 86% winners lead concrete)

1. **Show HN: Every PR in this repo carries a receipt of the AI that built it**
   — the differentiator nobody else can claim; invites "prove it" clicks that
   land on actual receipts.
2. Show HN: Receipts for AI coding agents — local, deterministic, cited prices
   — the category title; safest.
3. Show HN: Your AI coding agent just billed you. Here's the receipt
   — the tagline verbatim; strongest voice, least information.

Recommendation: **1**. The repo is the demo; the title should point at it.

## Post body (≤150 words; HN punishes marketing prose)

> aireceipts is a local CLI that reads the transcripts your coding agent
> already writes (Claude Code, Codex, Cursor, opencode) and prints a cost
> receipt: per-tool observable floors, cache economics, heuristic pattern flags, and a PR-level
> receipt of every agent session behind a pull request.
>
> The honesty rules are the product: no fabricated dollars (unpriced models
> render tokens-only), every price cited to a dated vendor page checked in
> CI, byte-deterministic output golden-tested 10× per commit, and a doc on
> what a receipt can and can't prove (docs/trust.md).
>
> The repo is agent-built under a spec harness and dogfoods itself: every
> PR carries the receipt of the sessions that built it — including the day
> the attribution engine caught itself crediting a $965 session to the
> wrong PR, and the spec + fix that followed.
>
> `npx aireceipts-cli` — no accounts, no servers; your transcripts and code
> never leave your machine (only anonymous, content-free diagnostics, off with
> one env var — see the first comment).

## Prepared first comment (post immediately under your submission)

> Maintainer here. Three honest disclosures up front: (1) built largely by AI
> agents under an adversarial spec pipeline — every PR carries its receipt,
> so you can audit exactly what that cost; (2) the numbers have known
> failure modes, all documented in docs/trust.md ("where the numbers can go
> wrong") — if you find one we missed, that file takes PRs; (3) it sends
> anonymous, content-free diagnostics on by default — never transcript
> content, prompts, paths, or dollar amounts; `--telemetry-show` prints the
> exact payload and sends nothing, and `AIRECEIPTS_TELEMETRY=off` (or
> `DO_NOT_TRACK=1`) makes it zero network calls. Schema: docs/telemetry.md.

The telemetry disclosure is deliberate and goes first, not buried: a
"nothing leaves your machine" tool that phones home at all will be asked
about it on HN, and volunteering it reads as honesty while being asked
reads as a dodge.

## The claude-receipts reply

Committed verbatim in `docs/internal/readme-evidence.md` — paste, don't improvise.

## Sequencing (from the session runbook, 2026-07-04)

Status (2026-07-05): the repo is public and **v0.2.0 is live on npm** — the
publish and repo-flip steps below are done. The one remaining precondition is
a clean-machine smoke test: `npx aireceipts-cli` (and `setup`) on a box that
has never seen this repo, ideally one with real agent sessions and one with
none. The submission must never precede a working `npx aireceipts-cli`.

Historical runbook order (kept for the record): #46 labeling → flip public →
verification hour (viewer, share loop, hero) → `gh repo edit`
description/topics → settings toggles (#81) → `/release` → npm publish →
THEN post.
