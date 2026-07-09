# Contributing

aireceipts is mostly built by AI coding agents under a spec-driven harness —
`docs/internal/harness.md` has the full design. This file is the practical version.

## The pipeline

Most changes start as a spec, not a PR:

1. **Issue** — file one of the templates below and label it.
2. **Spec** — drafted under `specs/`, then validated (self-audit, an independent
   critic, a value-gate check, mechanical lint) before a maintainer approves it.
3. **Build** — implemented on a branch; docs ride in the same PR, not "later."
4. **Review** — an independent critic runs the gates and records a review. A
   tool-use hook blocks `gh pr create`/`gh pr merge` without one — there's no
   way around this step, for an agent or a human.
5. **PR** — opened with `.github/pull_request_template.md` filled in, carrying
   the build receipt of the session that wrote it (see below).
6. **Merge** — a maintainer's call.

**PRs that skip the gates** get this, verbatim, then get closed: "Thanks for
the PR — this repo merges on green gates only (see the command below); happy
to reopen once `npx tsc --noEmit && npx eslint . --max-warnings 0 && npx
vitest run && node scripts/verify-goldens.mjs && node scripts/spec-lint.mjs &&
node scripts/hygiene.mjs` passes locally." Written once so it's never
re-litigated per submission — curl's public bounty postmortem is the argument
for having this ready rather than improvised.

## Humans are welcome

You don't need to be an agent to send a patch. File an issue, or open a PR
directly for something small and obviously in scope — a typo, a broken link, a
price correction. The gates don't know or care who wrote the diff:

```sh
npx tsc --noEmit && npx eslint . --max-warnings 0 && npx vitest run \
  && node scripts/verify-goldens.mjs && node scripts/spec-lint.mjs \
  && node scripts/hygiene.mjs
```

All must exit 0 before a PR merges. `AGENTS.md` is the operating manual if you
want the full picture (invariants, file ownership, verification commands).

**One command, before you push:** `npm run ship-check -- --title "<your PR title>"`
runs every fast gate CI enforces in one shot — `preflight --quick` (build, tsc,
eslint, goldens, spec-lint, hygiene, and the README guard) plus the PR-title lint —
so a mechanical failure never bounces off CI or a reviewer. Run it (and fix what it
finds) *before* asking for review, not after. Working in a git worktree? Run
`npm run setup:worktree` once first — it links the main checkout's `node_modules`
(without it, `vitest` and `verify-goldens` fail spuriously) and fetches `origin/main`.

If your session built the change, attach its receipt before opening the PR:
`npx aireceipts-cli pr --post` (see `docs/pr-receipts.md`). Humans without a
session to attach can skip this.

Found a security issue instead? Don't open a PR or public issue for it —
`SECURITY.md` has the private reporting path, and it requires a working
reproduction.

## Adding to the extension surfaces

Three things people usually ask for, each with its own recipe:

- **A new agent's transcript format** — `.claude/skills/add-vendor-adapter/`.
- **A new waste-detection check** — `.claude/skills/add-waste-check/`.
- **A vendor price correction** — file a `vendor-price` issue with a cited,
  dated source; `.claude/skills/update-prices/` is the recipe. Every price row
  needs a real citation — invariant I2 bans fallback or guessed prices, and a
  hook rejects uncited edits at the tool level.

Skills themselves are maintainer-curated, not something agents add unprompted.

## Code of conduct

Be direct, be kind, cite your sources. Full text:
[`.github/CODE_OF_CONDUCT.md`](.github/CODE_OF_CONDUCT.md).
