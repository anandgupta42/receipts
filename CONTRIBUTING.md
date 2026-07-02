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

If your session built the change, attach its receipt before opening the PR:
`npx aireceipts pr --post` (see `docs/pr-receipts.md`). Humans without a
session to attach can skip this.

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

Be direct, be kind, cite your sources.
