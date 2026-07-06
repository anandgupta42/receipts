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
> receipt: per-tool spend, waste lines, and a PR-level receipt of every
> agent session behind a pull request — and it works retroactively, on
> sessions already on disk.
>
> Every receipt ends with a handoff: the session's measured waste becomes
> a paste-ready instruction for the next run. A suggestion graduates to a
> standing rule only after recurring across 3+ sessions — a one-off
> fluke never becomes a rule — and an empty handoff prints "nothing to
> hand off," never invented advice.
>
> No fabricated dollars: every price is cited to a dated vendor page
> checked in CI; byte-deterministic, golden-tested 10x per commit
> (docs/trust.md).
>
> `npx aireceipts-cli` — no accounts, no servers; transcripts never leave
> your machine (anonymous, content-free diagnostics, off with one env
> var — see the first comment).

Word count (post body only): 148.

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

## Prepared handoff answer (paste if asked "how do you avoid false positives?")

> The handoff prints exactly what fired on that session — each waste line
> with what it cost — extracted from the transcript, never summarized, so
> nothing can be paraphrased away. If nothing fired, it says so: `nothing
> to hand off`, instead of inventing advice to fill the space.
>
> Standing-rule suggestions (a `CLAUDE.md` line to add) are gated
> separately and more strictly: a waste class has to recur across 3 or
> more distinct recent sessions — not just repeat inside one session —
> before it's ever suggested as a rule. `--handoff-threshold` controls
> that number; the default is 3. That recurrence gate is the actual
> false-positive control: a one-off fluke never becomes a standing rule.
> Worked example: docs/guide/09-handoff.md.

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
