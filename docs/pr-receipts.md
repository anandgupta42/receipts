# PR receipts — attach the building session's receipt to a PR

`aireceipts pr` attaches the cost receipt of the AI-agent session that built a branch to
that branch's pull request, as a single marked comment refreshed on each push.
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
to your repo (`gh auth login`); no other tokens are involved, and receipt data goes only
to GitHub. (Like every command, `pr` may also flush the content-free
[usage telemetry](telemetry.md) unless disabled — that endpoint never receives receipt
data.) Re-running after
more commits edits the same comment in place — no comment spam. If auto-selection finds
more than one matching session (or you want a specific one), pass `--session <id>` (an id
from `aireceipts --list`):

```sh
npx aireceipts-cli pr --post --session <id>
```

One `--session` keeps the exact-session override. To attach work that fell
outside the conservative auto window while retaining auto-found authors and
helpers, repeat the flag for every explicit attachment:

```sh
npx aireceipts-cli pr --post --session <lead-id> --session <retry-id>
```

Two or more occurrences form `auto-selected ∪ explicitly listed`, deduplicated
by transcript file. A missing id fails before anything is rendered or posted;
flags never silently overwrite one another.

### Evidence a PR receipt cannot recover

- **Work not present on disk.** A deleted/moved transcript or missing
  `subagents/` tree is indistinguishable from work that never happened. There is
  no honest floor the CLI can emit without evidence; `--session` helps only while
  the transcript still exists.
- **A commit result still in flight.** If the agent invokes `git commit` and
  `aireceipts pr --post` before that same tool call's result has been persisted,
  the final SHA is not yet available for attribution. Run the receipt after the
  committing call returns.
- **A rewritten commit with no surviving proof.** A content-changing amend or
  squash cannot be tied back to a session by patch-id unless the transcript also
  captured the final branch SHA. It is excluded/floored rather than guessed in.

These are local-evidence limits, not arithmetic fallbacks. See
[what a receipt proves](trust.md) for the full list.

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

#### In your own repo (any agent, paste-ready)

The same always-on layer for a repo that has adopted aireceipts. This is the
agent-agnostic option: it fires on every `git push`, whether the push came from
Claude Code, Codex, another tool, or your own shell. Save this as
`.git/hooks/pre-push` in your clone and make it executable:

```sh
#!/bin/sh
# aireceipts: attach the session receipt ref (refs/aireceipts/<slug>) on push.
# Best-effort: never blocks a push, silent on every failure path.
# Recursion guard: the nested `git push` of the receipt ref inherits this env
# flag, so the guard holds even when a hook dispatcher runs this file with
# stdin closed.
[ -n "${AIRECEIPTS_PREPUSH_ACTIVE:-}" ] && exit 0
AIRECEIPTS_PREPUSH_ACTIVE=1
export AIRECEIPTS_PREPUSH_ACTIVE
if command -v aireceipts >/dev/null 2>&1; then
  aireceipts pr --store ref --push-ref >/dev/null 2>&1 || true
elif command -v npx >/dev/null 2>&1; then
  npx -y aireceipts-cli@latest pr --store ref --push-ref >/dev/null 2>&1 || true
fi
exit 0
```

```sh
chmod +x .git/hooks/pre-push
```

Every branch push now also pushes `refs/aireceipts/<slug>`, and the committed
[PR check workflow](https://github.com/anandgupta42/receipts/blob/main/docs/adopt/pr-check-caller.yml)
renders and posts the receipt comment on the PR with no further step. Honest
scope: receipts are generated locally, never in CI, so this covers pushes from
the machines that hold the agent transcripts, one clone at a time (git does not
sync hooks). Teammates either paste the same file into their clones or rely on
the committed agent hooks below, which travel with the repo. A global install
(`npm i -g aireceipts-cli`) keeps the hook fast; without one it falls back to
`npx`. If the repo already manages hooks (husky, a central `core.hooksPath`
dispatcher), don't replace them — chain this file from the existing hook; it
tolerates being run with stdin closed.

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

## For maintainers (workflow + agent producer)

### Step 1 — Commit the PR check workflow

Put one of these callers under `.github/workflows/`.

**Recommended — self-contained, npm-native**
([`adopt/pr-check-caller.yml`](https://github.com/anandgupta42/receipts/blob/main/docs/adopt/pr-check-caller.yml)). Use this when your org restricts third-party reusable workflows, or when you
prefer a self-contained job. Commit it as `.github/workflows/aireceipts.yml`:

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
        continue-on-error: ${{ vars.AIRECEIPTS_REQUIRE_PR_RECEIPT != 'true' || github.event.pull_request.head.repo.full_name != github.repository }}
        env:
          GH_TOKEN: ${{ github.token }}
          AIRECEIPTS_REQUIRE_PR_RECEIPT: ${{ vars.AIRECEIPTS_REQUIRE_PR_RECEIPT }}
```

**Reusable workflow**
([`adopt/pr-receipt-check-caller.yml`](https://github.com/anandgupta42/receipts/blob/main/docs/adopt/pr-receipt-check-caller.yml)). Use this when your org allows third-party reusable workflows and you want the
check logic to track upstream via `@latest`. Commit it as
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

### Step 2 — Commit the local producer hooks

Add the hook for each coding agent the repo uses.

#### Claude Code

Commit `.claude/settings.json` ([template](https://github.com/anandgupta42/receipts/blob/main/docs/adopt/claude-settings.json)):
The `|| true` matters: the CLI itself exits 0 on every path, but if `npx` cannot even
fetch or start it (registry outage, cold cache timeout), the hook must still succeed —
a receipt is never worth blocking a push.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "npx -y aireceipts-cli@latest hook pre-push || true",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

#### Codex

Commit `.codex/hooks.json` ([template](https://github.com/anandgupta42/receipts/blob/main/docs/adopt/codex-hooks.json)) with the same command:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "npx -y aireceipts-cli@latest hook pre-push || true",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

[Codex loads project hooks](https://learn.chatgpt.com/docs/hooks) only for trusted
projects. Review and trust the exact hook definition once through `/hooks`; changed
definitions require review again.

Chained agent commands still auto-attach when they contain an unambiguous branch push
and keep the same working directory; output redirections are ignored and the hook attaches once.

### Step 3 — Keep the Codex finalizer instruction

Add this second producer path to `AGENTS.md`:

> Before you finish a PR-producing task, run `npx aireceipts-cli pr --post` from the repo worktree and include any failure message in the handoff.

### Step 4 — Tell contributors

Add one line to `CONTRIBUTING.md`:

> After opening or updating a PR, run `npx aireceipts-cli pr --post` to attach your build receipt.

The workflow is the reader/poster; the local agent hook is the producer. The workflow
alone is a no-op until a branch carries `refs/aireceipts/<slug>`, produced by one of the
hooks above or manually with:

```sh
npx aireceipts-cli pr --store ref --push-ref
```

The ref's internal producer/CI payload remains
`PR_RECEIPT_SCHEMA_VERSION = 1`. It is not the public `--json`/`--csv` schema
(currently v2), and it intentionally has no `costSemantics` field: it stores
renderer inputs, while the rendered comment itself qualifies dollar floors
with `≥`. See the [export schema](json-schema.md#versioning-semver-discipline-r4).

Codex hooks are best-effort. Current Codex `PreToolUse` interception does not cover every
shell path, including some `unified_exec` calls, so the `AGENTS.md` finalizer is a second
chance and CI enforcement is the merge-time backstop. For the strongest agent-independent
local path, a repo can also wire `pr --store ref --push-ref` into its own Git pre-push hook;
Git requires one-time activation and never auto-runs a fetched hook.

Safe to run alongside another `refs/receipts/*` producer (e.g. an attestation tool):
aireceipts writes and reads only its own `refs/aireceipts/*` namespace, so the two never
fight over the same refs. (Earlier versions shared `refs/receipts/*`, which left
`pr-check` reading a foreign-schema payload and silently posting nothing; the dedicated
namespace removes that collision.)

**Footprint (what this actually adds to your repo).** One workflow plus the hook files for
the coding agents you use. Keep the `AGENTS.md` fallback for Codex; the one-line
`CONTRIBUTING.md` reminder is optional. The check is
**notice-only by default** — a neutral `::notice` when a receipt is missing, nothing
otherwise, and a failing build only if you opt into same-repo enforcement. aireceipts **never commits receipt files** to your tree: a receipt is a PR
comment or a git ref (`refs/aireceipts/…`), both invisible in your source and your PR
diffs. Remove it anytime by deleting the workflow and the relevant `.claude/settings.json`
or `.codex/hooks.json` hook entry.

**Turn it up when you want — opt-in and escapable:**

- **Enforce** — set the repo variable `AIRECEIPTS_REQUIRE_PR_RECEIPT=true` to make same-repo
  PRs require an attached receipt. Branches matching `AIRECEIPTS_RECEIPT_EXEMPT_GLOBS`
  (space-separated anchored globs; default `release/*` when unset) stay notice-only:
  release checkouts have no capturable agent session, so no receipt can exist for them. In the npm-native workflow, the variable is forwarded
  to `pr-check` and disables `continue-on-error` for same-repo PRs, so a missing comment
  really fails the check. If a receipt comment is already attached but a fresh update
  transiently fails (e.g. a GitHub write error), the check accepts the existing comment
  and re-syncs it on the next run — a strict PR never flaps red on a transient write, at
  the cost of the comment briefly lagging the latest push. Fork PRs keep
  `continue-on-error` even when the variable is true.
  Mark the receipt-check job as a required status check in the target branch's
  ruleset or branch protection; otherwise a red check is visible but does not block a
  merge. Fork PRs always stay notice-only (source transcripts live on the contributor's
  machine, so CI can't generate one).
- **Fully seamless** — two opt-in layers now exist. **CI posts for you:** when a
  branch carries a `refs/aireceipts/<slug>` ref, the check renders and posts the receipt
  comment itself via `GITHUB_TOKEN`, so a contributor needs no local `gh`. **Auto-attach on
  push:** the committed Claude Code or Codex hook above writes and pushes that ref before a
  supported agent-run `git push`. For this repo's own contributors, the older
  `.githooks/pre-push` path still
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
  presented as PR cost), and one indented `SUBAGENTS (N)` aggregate row for
  child sessions whose observable intervals overlap that parent scope
  (SPEC-0060). A sliced parent with no observable time range has an unknown
  child window: readable child costs are excluded instead of being claimed
  whole, while unreadable child evidence remains counted.
- One combined total. Priced and unpriced sessions are never blended: dollars and
  tokens total separately.
- An honest note counting any plausible-but-unproven sessions that were **not**
  attributed.
- A collapsed `full receipts` section: a per-session ledger table, each session's
  full receipt, and — for a session that launched subagents — a `subagents (N)`
  table under its receipt, sorted by cost and capped at 20 rows where the last
  row carries the remainder's sum (a capped list never silently drops value).
- When a counted session fires a detector, a collapsed `handoff — flagged
  pattern cost ≈ …` section. Its headline is an overlap-safe heuristic subtotal
  with the explicit line `not proven savings`; it is not a savings floor or
  ceiling.

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
One selector is an exact override; two or more are additive to this auto set.
The `cwd`/branch/SHA signals used for matching are attribution-only: they never enter
the rendered receipt, `--json`/`--csv`, or telemetry.

Child rollups use true interval intersection, not endpoint containment: a
child is included whole when `child.start <= parent.end` and
`child.end >= parent.start`, including a child that spans the parent range. No
readable child is included when a sliced parent lacks both usable bounds.
