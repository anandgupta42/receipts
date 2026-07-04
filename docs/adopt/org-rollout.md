# Rolling out receipt checks across a fleet of repos

For one repo, adoption is the 3-line caller — see
[pr-receipt-check-caller.yml](pr-receipt-check-caller.yml) and
[docs/pr-receipts.md](../pr-receipts.md).

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

Two constraints inherited from GitHub:

- The caller references the receipts repo by name; reusable-workflow
  references are **not** redirected if that repo is ever renamed — callers
  should only be created once the source repo's name is final.
- The receipt check never fails a build (it emits a neutral notice), so
  adopting it is zero-risk for CI.
