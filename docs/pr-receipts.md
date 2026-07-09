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

### Always-on: pre-push hook

This is optional and not required for adoption — it's a convenience layer, not a
replacement for the one command above. Enable it once per clone:

```sh
npm run setup:hooks
```

> **Scope:** `npm run setup:hooks` and the committed `.githooks/` live in **this repo's
> own source tree** — they are not part of the published npm package, so this exact wiring
> is for aireceipts' own contributors. The underlying flags (`aireceipts pr --store ref
> --push-ref`) work in any repo; a repo that has adopted aireceipts can point
> `core.hooksPath` at its own hook that calls them.

That points `core.hooksPath` at the committed `.githooks/` and builds the CLI (the hook
runs the built `dist/`, or a global `aireceipts` if you have one). From then on, every
`git push` of a branch runs `aireceipts pr --store ref --push-ref` for you: it writes the
receipt to `refs/aireceipts/<slug>` and pushes that ref alongside your branch, with no extra
step. It's best-effort and **never blocks the push** — a missing session, a repo without
`gh`, an unbuilt CLI, or a push failure is swallowed silently and the push proceeds. (Git
never runs a fetched hook automatically, so this one command is unavoidable; the CI check
is the install-free layer that catches a missed receipt regardless.)

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

## For maintainers (automatic repo integration, 2 files)

1. Commit a PR receipt check workflow under `.github/workflows/`. Two caller
   variants do the same job — pick one:

   **Recommended — self-contained, npm-native**
   ([`adopt/pr-check-caller.yml`](adopt/pr-check-caller.yml)). *Use this one if*
   your org restricts third-party reusable workflows, or you'd simply rather not
   depend on one: it runs the check inside your own workflow with no
   reusable-workflow `uses:`, so it never hits an Actions org-policy gate. Commit
   it as e.g. `.github/workflows/aireceipts.yml`:

   ```yaml
   name: aireceipts
   on: [pull_request]
   permissions:
     contents: read
     pull-requests: write
   concurrency:
     group: aireceipts-${{ github.workflow }}-${{ github.ref }}
     cancel-in-progress: true
   jobs:
     check:
       runs-on: ubuntu-latest
       steps:
         - run: npx -y aireceipts-cli@latest pr-check
           continue-on-error: true
           env:
             GH_TOKEN: ${{ github.token }}
   ```

   **Reusable workflow**
   ([`adopt/pr-receipt-check-caller.yml`](adopt/pr-receipt-check-caller.yml)).
   *Use this one if* your org allows third-party reusable workflows and you want
   the check logic to track upstream automatically via `@latest`. Commit it as
   `.github/workflows/pr-receipt-check.yml`:

   ```yaml
   name: pr-receipt-check
   on: [pull_request]
   permissions:
     contents: read
     pull-requests: write
   jobs:
     check:
       uses: anandgupta42/receipts/.github/workflows/pr-receipt-check.yml@latest
   ```

2. Commit the Claude Code auto-attach hook as `.claude/settings.json`
   ([template](adopt/claude-settings.json)):

   ```json
   {
     "hooks": {
       "PreToolUse": [
         {
           "matcher": "Bash",
           "hooks": [
             {
               "type": "command",
               "command": "npx -y aireceipts-cli@latest hook pre-push",
               "timeout": 60
             }
           ]
         }
       ]
     }
   }
   ```

3. Add one line to `CONTRIBUTING.md`:

   > Before opening a PR, run `npx aireceipts-cli pr --post` to attach your build receipt.

The workflow is the reader/poster; the hook is the producer. The workflow alone is a
no-op until a branch carries `refs/aireceipts/<slug>`, produced by the Claude hook above
or manually with:

```sh
npx aireceipts-cli pr --store ref --push-ref
```

Codex is manual for now: Codex `exec` does not currently invoke lifecycle hooks. The
hidden `hook pre-push` subcommand accepts a Codex-shaped payload for forward
compatibility, but do not count on Codex auto-attach until Codex hooks exist.

Safe to run alongside another `refs/receipts/*` producer (e.g. an attestation tool):
aireceipts writes and reads only its own `refs/aireceipts/*` namespace, so the two never
fight over the same refs. (Earlier versions shared `refs/receipts/*`, which left
`pr-check` reading a foreign-schema payload and silently posting nothing; the dedicated
namespace removes that collision.)

**Footprint (what this actually adds to your repo).** Two committed files for the
automatic path (plus, optionally, a one-line note in `CONTRIBUTING.md`). The check is
**notice-only by default** — a neutral `::notice` when a receipt is missing, nothing
otherwise, and a failing build only if you opt into same-repo enforcement. aireceipts **never commits receipt files** to your tree: a receipt is a PR
comment or a git ref (`refs/aireceipts/…`), both invisible in your source and your PR
diffs. Remove it anytime by deleting the workflow and the `.claude/settings.json` hook
entry.

**Turn it up when you want — opt-in and escapable:**

- **Enforce** — set the repo variable `AIRECEIPTS_REQUIRE_PR_RECEIPT=true` to make same-repo
  PRs require a receipt. Fork PRs always stay notice-only (source transcripts live on the
  contributor's machine, so CI can't generate one).
- **Fully seamless** — two opt-in layers now exist. **CI posts for you:** when a
  branch carries a `refs/aireceipts/<slug>` ref, the check renders and posts the receipt
  comment itself via `GITHUB_TOKEN`, so a contributor needs no local `gh`. **Auto-attach on
  push:** the committed Claude Code hook above writes and pushes that ref before an agent-run
  `git push`. For this repo's own contributors, the older `.githooks/pre-push` path still
  exists behind `npm run setup:hooks`. Either way a contributor can still just run
  `npx aireceipts-cli pr --post`. Each layer is opt-in and notice-only until turned on.

The two workflow variants above (self-contained npm-native, or the reusable workflow)
are the reader/poster half of this; the enforcement and seamless tiers apply to either.

CI still never generates a receipt itself: the source transcripts stay local (I1/I4).
Rolling out across a whole org: [docs/adopt/org-rollout.md](adopt/org-rollout.md).

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
