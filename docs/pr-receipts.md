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

### Optional: publish a durable receipt page

```sh
npx aireceipts pr --post --artifact
```

`--artifact` (requires `--post`) additionally writes a self-contained
`pr-<n>.html` — the concise rollup plus every session's full per-tool
receipt — to a dedicated `aireceipts/artifacts` branch of the PR's base repo,
and appends one `full receipt:` link to the comment. The link only appears
after the push is confirmed; if you lack push rights the comment still posts,
just without the link.

The comment link opens the artifact through the **aireceipts viewer**
(`view.html` on the project site): a static page that fetches the raw file
from GitHub in the reader's browser and renders it in a fully sandboxed
frame — no server, no third party, works for any repo's artifacts with zero
setup. Two honest limits: the viewer only accepts `raw.githubusercontent.com`
/ `github.com` blob URLs (anything else is refused — your receipt page must
never become a generic HTML renderer), and **private repos can't render**:
anonymous raw fetches 404 there, so the viewer shows its error with a direct
GitHub link (readable as source by anyone with access) until the repo is
public. Publishing writes nothing to your working tree, index, or current
branch, and each PR's file is overwritten in place — other PRs' artifacts are
never touched.

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
- A fenced receipt headed `N sessions behind this PR`: one row per contributing
  session (`<role> · <model mix> · <cost>`), a muted provenance line under each
  (session id + `session slice: turns A–B of N`, or `entire session (slice
  unavailable)` when the work can't be cut cleanly — ambiguity is labeled, never
  presented as PR cost), and indented `SUBAGENTS` sub-rows for any subagent
  sessions a contributor launched.
- One combined total. Priced and unpriced sessions are never blended: dollars and
  tokens total separately.
- An honest note counting any plausible-but-unproven sessions that were **not**
  attributed.

## How sessions are matched to a PR

Auto-selection (no `--session`) credits every session that can be tied to the branch,
conservatively:

- A session whose recorded git output contains one of the **branch's commit SHAs** is
  credited wherever it ran — another checkout, another repo's working directory, or an
  agent-team sidechain. The commit SHA is the primary attribution key; a sidechain is
  promoted to its own row only when no other credited session already counts it.
- A session inside one of this repo's worktrees that time-overlaps the branch's commit
  window gets the softer rules: a Codex session there with **no** git writes at all is
  credited as a helper on cwd+time.
- Everything else is excluded. Sessions without SHA proof outside the repo are never
  credited — and never guessed in.

Zero credited sessions → `aireceipts pr` refuses to guess and asks for `--session <id>`.
The `cwd`/branch/SHA signals used for matching are attribution-only: they never enter
the rendered receipt, `--json`/`--csv`, or telemetry.
