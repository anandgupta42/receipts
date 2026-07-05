# Contributing

aireceipts is mostly built by AI coding agents under a spec-driven harness —
`docs/internal/harness.md` has the full design. You do **not** need Claude Code,
Codex, the repo-local skills, or the maintainer hooks to contribute. This file is the
public contract: what makes a patch reviewable and mergeable.

## Contribution lanes

- **Small, obvious fixes** can be opened directly: typos, broken links, focused tests,
  documentation clarifications, small CLI bugs with a reproduction.
- **Bug fixes** should include the failing case first: a fixture, unit test, golden, or
  CLI repro that fails before the fix and passes after it.
- **Price corrections** need a dated vendor source URL and quoted price text. Invariant
  I2 bans guessed dollars, and CI rejects uncited price rows.
- **Non-trivial features or behavior changes** start with an issue and usually become a
  spec under `specs/` before code. A maintainer owns spec approval.

If you are unsure which lane fits, open an issue with the smallest reproduction or
problem statement you have. The maintainer can turn it into a spec or ask for a narrower
PR.

## What must be true before merge

Install dependencies once with `npm ci`, then run the same core gate CI runs. Keep the
commands unmasked; do not pipe them through `tail`, `grep`, or `head`.

```sh
npx tsc --noEmit;                    echo $?
npx eslint . --max-warnings 0;       echo $?
npx vitest run;                      echo $?
node scripts/verify-goldens.mjs;     echo $?
node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs; echo $?
node scripts/spec-lint.mjs;          echo $?
node scripts/hygiene.mjs;            echo $?
```

All must exit 0 before merge. CI also runs package/preflight checks, CLI e2e tests, and
mutation testing when money-path files (`src/pricing/**` or `src/pr/**`) change.

User-visible changes update docs/help/goldens in the same PR. Receipt output changes
must update goldens deliberately and explain the diff. Price table changes must cite the
source row-by-row.

## Specs, review, and the local harness

The maintainer harness adds stricter automation around the public contract: S1-S4 spec
validation, independent critic review, `.review-ok` markers, Claude Code tool hooks, and
automatic PR receipts. Those are maintainer-local guardrails, not prerequisites for a
fork contributor.

The goal still applies to everyone: specs for substantial work, green gates, cited
numbers, byte-stable receipts, docs with behavior changes, and a maintainer review before
merge. If a maintainer asks for a spec or a deeper review on your PR, they will say what
is missing and help translate the harness requirement into normal GitHub steps.

## PR receipts

If an AI-agent session built the change, attach its receipt before review:

```sh
npx aireceipts-cli pr --post
```

Posting needs the `gh` CLI and a pull request. If you are on a fork, do not have `gh`, or
the command finds no matching local session, paste the command's failure message or note
that no local agent session is available in the PR's **Evidence** section. Human-written
PRs can skip the receipt until the declared-human receipt flow in SPEC-0039 ships.

The public PR receipt check is notice-only by default, especially for forks, because
transcripts live on the contributor's machine and CI cannot generate them. Maintainers
may enforce receipts for same-repo agent branches.

## Adding to the extension surfaces

Three things people usually ask for, each with its own recipe:

- **A new agent's transcript format** — `.claude/skills/add-vendor-adapter/`.
- **A new waste-detection check** — `.claude/skills/add-waste-check/`.
- **A vendor price correction** — file a `vendor-price` issue with a cited,
  dated source; `.claude/skills/update-prices/` is the recipe. Every price row
  needs a real citation — invariant I2 bans fallback or guessed prices, and a
  hook rejects uncited edits at the tool level.

These skill files are maintainer recipes and useful reference material. They are not
tools you need installed to contribute. Skills themselves are maintainer-curated, not
something agents add unprompted.

Found a security issue instead? Don't open a PR or public issue for it —
`SECURITY.md` has the private reporting path, and it requires a working reproduction.

## Code of conduct

Be direct, be kind, cite your sources. Full text:
[`.github/CODE_OF_CONDUCT.md`](.github/CODE_OF_CONDUCT.md).
