# PR receipts — attach the building session's receipt to a PR

`aireceipts pr` attaches the cost receipt of the AI-agent session that built a branch to
that branch's pull request, as a single marked comment that stays current across pushes.
Transcripts live on the developer's machine, never on the CI runner — so generation is
local. CI checks for the marked receipt comment and is notice-only by default, with an
opt-in setting for maintainers who want same-repo PRs to require a receipt.

## For contributors and coding assistants (one command)

From your checkout (or worktree) with the PR branch checked out:

```sh
npx aireceipts-cli pr --post
```

That is the finalizer for humans, Codex, Claude Code, OpenCode, Cursor, and any other
coding assistant. It discovers supported local agent sessions, matches them to the
current repo/worktree and PR branch, renders the exact comment body, then upserts one
marked PR comment through `gh`.

`npx` needs Node/npm. Posting needs the [`gh` CLI](https://cli.github.com/) authenticated
to your repo (`gh auth login`); no other tokens or servers are involved. Re-running after
more commits edits the same comment in place — no comment spam. If auto-selection finds
more than one matching session (or you want a specific one), pass `--session <id>` (an id
from `aireceipts --list`):

```sh
npx aireceipts-cli pr --post --session <id>
```

The receipt always prints to stdout first, so even with no `gh` or no PR yet you can
copy the body straight into a comment.

For a dry run without posting:

```sh
npx aireceipts-cli pr
```

### Assistant instruction

Use the same instruction for every coding assistant:

```text
Before you finish a PR-producing task, run `npx aireceipts-cli pr --post` from the repo worktree and include any failure message in the handoff.
```

### Optional convenience: git alias

This is only a local shortcut. It is not required for adoption and does not replace the
one command above.

```sh
git config alias.receipt '!npx aireceipts-cli pr --post'
git receipt                  # after pushing your branch
```

### Optional: publish a durable receipt page

```sh
npx aireceipts-cli pr --post --artifact
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
setup. Two honest limits: the viewer refuses
everything except aireceipts artifact paths on GitHub raw/blob URLs
(`…/aireceipts/artifacts/pr-<n>.html` — it must never become a generic HTML
renderer), and **private repos can't render**:
anonymous raw fetches 404 there, so the viewer shows its error with a direct
GitHub link (readable as source by anyone with access) until the repo is
public. Publishing writes nothing to your working tree, index, or current
branch, and each PR's file is overwritten in place — other PRs' artifacts are
never touched. The viewer page itself carries no analytics or beacons (I4's
spirit): nobody, including the aireceipts project, learns
who viewed which receipt.

## For maintainers (repo integration, 2 minutes)

1. Add the check, either way:

   **As an action step** ([paste-ready file](adopt/pr-receipt-check-action.yml)):

   ```yaml
   name: pr-receipt-check
   on: [pull_request]
   permissions:
     contents: read
     pull-requests: read
   jobs:
     check:
       runs-on: ubuntu-latest
       steps:
         - uses: anandgupta42/receipts@main
           # with:
           #   require-receipt: "true"
   ```

   **Or as a reusable workflow** ([template](adopt/pr-receipt-check-caller.yml)):

   ```yaml
   name: pr-receipt-check
   on: [pull_request]
   jobs:
     check:
       uses: anandgupta42/receipts/.github/workflows/pr-receipt-check.yml@main
   ```

   Same check either way — pick whichever fits your workflow layout. The action
   form takes `require-receipt: "true"` as an input; the workflow form reads the
   repo variable `AIRECEIPTS_REQUIRE_PR_RECEIPT=true`.

2. Add one line to `CONTRIBUTING.md`:

   > Before opening a PR, run `npx aireceipts-cli pr --post` to attach your build receipt.

That's it. By default, the check emits a neutral `::notice` when a PR has no receipt
comment and never fails the build. Enforcement applies to same-repo PRs only; fork PRs
stay notice-only because source transcripts remain on the contributor's machine. CI
still never generates a receipt itself: the source transcripts stay local. Rolling out
across a whole org: [docs/adopt/org-rollout.md](adopt/org-rollout.md).

There is no aireceipts GitHub App or bot: receipts are generated and posted locally by
design, and a hosted App could never see the transcripts they're built from — the
decision record is [SPEC-0052](../specs/SPEC-0052-github-app-deferral.md).

## What the comment contains

- A marker line (`<!-- aireceipts-dogfood -->`) so the upsert and the CI check can find
  exactly one comment to keep current.
- A fenced receipt headed `N sessions behind this PR`: one row per contributing
  session (`<role> · <model mix> · <cost>`), a muted provenance line under each
  (session id + `session slice: turns A–B of N`, or `entire session (slice
  unavailable)` when the work can't be cut cleanly — ambiguity is labeled, never
  presented as PR cost), and one indented `SUBAGENTS (N)` aggregate row summing
  any subagent sessions a contributor launched (SPEC-0060).
- One combined total. Priced and unpriced sessions are never blended: dollars and
  tokens total separately.
- An honest note counting any plausible-but-unproven sessions that were **not**
  attributed.
- A collapsed `full receipts` section: a per-session ledger table, each session's
  full receipt, and — for a session that launched subagents — a `subagents (N)`
  table under its receipt, sorted by cost and capped at 20 rows where the last
  row carries the remainder's sum (a capped list never silently drops value).

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
