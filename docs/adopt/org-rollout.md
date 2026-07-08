# Rolling out receipt checks across a fleet of repos

For one repo, notice-only adoption starts with the workflow caller; automatic receipt
posting needs the two-file kit (workflow + Claude Code hook). See
[pr-receipt-check-caller.yml](pr-receipt-check-caller.yml),
[claude-settings.json](claude-settings.json), and [docs/pr-receipts.md](../pr-receipts.md).

For many repos (an org dogfood, a platform team), generate the adoption
packet:

```sh
node scripts/rollout-dogfood.mjs --org your-org --days 90
```

It enumerates repos active in the window (skipping archived repos, forks,
and repos already carrying the caller) and prints, per repo: the caller
file, the CONTRIBUTING line, and a copy-paste command sheet that opens a
PR. **It performs no repo or GitHub mutations** — each repo's owners review and merge their own
PR, and the script refuses to run until `aireceipts` is actually on npm
(a packet telling developers to run an unpublished command helps nobody).

**The default footprint is deliberately minimal.** The notice-only packet adds one
non-blocking workflow file (plus, optionally, a one-line CONTRIBUTING note): it never
fails a build, and aireceipts never commits receipt files (a receipt is a PR comment or a
git ref, invisible in the tree and PR diffs). Automatic receipts add the committed
`.claude/settings.json` PreToolUse hook that produces the ref when Claude Code runs
`git push`; the workflow alone is a no-op until that hook, or a manual
`pr --store ref --push-ref`, produces a ref. Enforcement
(`AIRECEIPTS_REQUIRE_PR_RECEIPT`) is opt-in and coarse — it makes same-repo PRs require a
receipt (fork PRs always stay notice-only). See the tiers in
[docs/pr-receipts.md](../pr-receipts.md).

Two constraints inherited from GitHub:

- The caller references the receipts repo by name; reusable-workflow
  references are **not** redirected if that repo is ever renamed — callers
  should only be created once the source repo's name is final.
- The receipt check never fails a build (it emits a neutral notice), so
  adopting it is zero-risk for CI.
