# PR receipts — attach the building session's receipt to a PR

`aireceipts pr` attaches the cost receipt of the AI-agent session that built a branch to
that branch's pull request, as a single marked comment that stays current across pushes.
Transcripts live on the developer's machine, never on the CI runner — so generation is
local, and CI only *notices* when a PR is missing its receipt.

## For contributors (30 seconds)

From your checkout (or worktree) with the PR branch checked out:

```sh
npx aireceipts pr            # dry-run: prints the exact comment body to stdout
npx aireceipts pr --post     # upserts the receipt comment on the PR via gh
```

`--post` requires the [`gh` CLI](https://cli.github.com/) authenticated to your repo
(`gh auth login`); no other tokens or servers are involved. Re-running after more commits
edits the same comment in place — no comment spam. If auto-selection finds more than one
matching session (or you want a specific one), pass `--session <id>` (an id from
`aireceipts --list`).

Prefer a git alias so it runs itself:

```sh
git config alias.receipt '!npx aireceipts pr --post'
git receipt                  # after pushing your branch
```

The receipt always prints to stdout first, so even with no `gh` or no PR yet you can
copy the body straight into a comment.

## For maintainers (repo integration, 5 minutes)

1. Copy one workflow file into your repo: `.github/workflows/pr-receipt-check.yml`
   (the thin caller that runs `scripts/check-pr-receipt.mjs` — copy that script too).
2. Add one line to `CONTRIBUTING.md`:

   > Before opening a PR, run `npx aireceipts pr --post` to attach your build receipt.

That's it. The workflow emits a neutral `::notice` when a PR has no receipt comment and
**never fails the build** — external contributors have no local sessions and must not be
blocked.

## What the comment contains

- A marker line (`<!-- aireceipts-dogfood -->`) so the upsert and the CI check can find
  exactly one comment to keep current.
- A `🧾 aireceipts — session <id>` header and a fenced receipt.
- A slice header: `session slice: turns A–B of N` when the PR's work is isolated to a
  commit window, or `entire session (slice unavailable)` when it can't be cut cleanly
  (ambiguity is labeled, never presented as PR cost).
- A `SUBAGENTS` section rolling up any subagent sessions the PR's work launched, with a
  combined total.

## How a session is matched to a PR

Auto-selection (no `--session`) picks the session whose working directory is inside one
of this repo's worktrees **and** whose time window overlaps the branch's commit window.
Zero matches or more than one → `aireceipts pr` refuses to guess and asks for
`--session <id>`. The `cwd`/branch used for matching are attribution-only: they never
enter the rendered receipt, `--json`/`--csv`, or telemetry.
