# Wiring preflight into CI

`scripts/preflight-release.mjs` (`npm run preflight`) is the consolidated
pre-release gate. It should run in two CI places. The exact edits are in
[`ci-preflight.patch`](ci-preflight.patch) — a git-applyable diff — reproduced
below. **Depends on** the preflight script being on `main` (PR #102).

> These are `.github/workflows/**` changes. A token needs `workflow` scope to
> push them, which this repo's automation token lacks — see **Applying** below.

## 1. `release-publish.yml` — the hard gate (before publish)

The publish workflow currently does `npm ci → npm run build → npm publish`. It
never re-runs the tests, goldens, or an install-and-run check on the SHA it
ships. Replace the bare build with preflight so **a red SHA cannot publish**:

```yaml
      - run: npm ci

      # Preflight is the release gate: build + lean-tarball shape + install the
      # real tarball and run the installed binary (priced receipt) + full suite +
      # goldens + determinism + cite-check liveness. A red SHA cannot publish.
      # (It builds internally, so the separate `npm run build` step is gone.)
      - name: preflight — the packaged artifact must install and run
        run: npm run preflight

      - name: publish with provenance (trusted publishing, OIDC)
        run: npm publish --provenance --access public
```

## 2. `ci.yml` — a fast job on every PR

`ci.yml` already runs the sub-checks (tsc, eslint, vitest, goldens, the
tarball-smoke e2e). What it does **not** check is the **publish-shape manifest**
(name/bin/exact-files-allowlist/no-prepack) and **tarball leanness**
(no sourcemaps, size/count). A `--quick` preflight job adds exactly that,
cheaply, so a packaging regression is caught on the PR that introduces it —
not at release:

```yaml
  preflight:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: "22.14"
      - run: npm ci
      - run: npm run preflight -- --quick
```

(`--quick` skips the full vitest + determinism — the `verify` job already runs
those — and is explicitly *not* release-valid; it never prints RELEASE-READY.)

## Applying

Pick one:

- **Grant the scope, then I push it** (cleanest — normal PR + review):
  `gh auth refresh -s workflow -h github.com`, then re-run the wiring so the two
  workflow files change in a reviewed PR.
- **Apply locally + push with a scoped token:**
  `git apply docs/internal/ci-preflight.patch` on a branch, then push from a
  token that has `workflow` scope.
- **Edit on github.com** (the web editor always has scope): open each workflow
  and paste the blocks above.

Whichever path, land it **after** PR #102 (the preflight script) is on `main`,
or the `npm run preflight` step won't exist.
