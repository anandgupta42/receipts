# Releasing aireceipts-cli to npm

The maintainer's runbook for what `/release` hands off: the actual npm publish.
`/release` prepares the tag, changelog, and spec/AGENTS bookkeeping; **this doc is
the publish itself**, which is partly manual (passkey, npm settings) and partly a
CI workflow. Written from the real first publish (v0.1.0, 2026-07-04) — every
gotcha here was hit for real.

## The names, fixed

- **npm package: `aireceipts-cli`.** The unscoped `aireceipts` is permanently
  refused — npm's typosquat filter rejects it as a look-alike of the existing
  `ai-receipts`. Do not retry the bare name.
- **Binary / typed command: `aireceipts`** (the `bin` field). Users install
  `aireceipts-cli` and then type `aireceipts`. Every doc distinguishes the
  package reference (`npx aireceipts-cli`) from the installed command (`aireceipts`).
- **Repo: `anandgupta42/receipts`.** **GitHub Pages site: `.github.io/receipts/`.**

## Two-tier publish model

| | First publish (once, done) | Every release after |
|---|---|---|
| Auth | manual `npm login` + passkey 2FA | OIDC, no credentials |
| Provenance | **no** (local can't attest) | **yes** (`--provenance` in CI) |
| Runner | your machine | `release-publish.yml` workflow |
| Why | npm won't let you configure a trusted publisher until the package exists | trusted publisher is configured |

The first publish is already done. **All future releases use the workflow** — you
should never `npm publish` from your machine again.

## Hard preconditions (all releases)

1. **Repo is public.** `npm publish --provenance` refuses on a private repo.
2. **`main` CI green** on the exact SHA being cut.
3. **`/release-manager` GO verdict** exists for this version+SHA, and **`/release`**
   has run (tag matches `package.json` version, changelog written, `building` specs
   flipped to `shipped`, `AGENTS.md` inventory updated, `/review-docs` clean).
4. **Node ≥ 22.14, npm ≥ 11.5.1** on whatever publishes (the workflow pins these;
   only relevant if you ever publish locally again — you shouldn't).

## Routine release (v0.1.1+) — the whole thing

```sh
# 1. bump the version (its own commit, on a branch → PR → merge to main)
#    patch = fixes, minor = new capability, major = receipt-format break (I5)
npm version patch --no-git-tag-version    # edits package.json + lockfile only
# commit, PR, merge (CI must be green on the merge commit)

# 2. from GitHub: Actions → "release-publish" → Run workflow → branch: main
#    (or: gh workflow run release-publish.yml --ref main)
```

The workflow (`.github/workflows/release-publish.yml`) does the rest: asserts the
repo/ref, asserts `package.json.repository` matches, asserts the npm floor,
`npm ci`, `npm run preflight` (build + tarball shape + install-and-run + full
suite), then `npm publish --provenance --access public`. OIDC means no token
anywhere. After the publish succeeds, its `tag-and-release` job pushes the
annotated `vX.Y.Z` tag and creates the GitHub Release, with the version's
section of `docs/CHANGELOG.md` as the notes — a missing changelog section fails
that job on purpose. (v0.1.0–v0.2.0 predate this job; their tags and Releases
were backfilled by hand on 2026-07-05.)

### After it succeeds

```sh
npm view aireceipts-cli version            # confirm the new version resolves
npx aireceipts-cli@latest --version        # from a clean shell / machine
gh release view v<X.Y.Z>                   # tag + Release + notes exist
```

## The trusted-publisher config (one-time, on npmjs.com)

Package **aireceipts-cli** → Settings → Trusted Publisher → **GitHub Actions**:

| Field | Value |
|---|---|
| Organization or user | `anandgupta42` |
| Repository | `receipts` |
| Workflow filename | `release-publish.yml` |
| Environment | *(blank)* |

This is what makes OIDC work. Configured once, after the first publish created the
package. If it's ever lost, the workflow fails with an auth error — re-add it here.

## What ships in the tarball (kept lean)

`package.json`'s `files` allowlist: `dist`, `data/prices`, `README.md`, `LICENSE`,
`NOTICE` (Apache-2.0 §4(d) requires NOTICE in redistributions). Nothing else — no
tests, specs, goldens, source, or sourcemaps.

- **Sourcemaps are off** (`tsup.config.ts` `sourcemap: false`) — they were 70% of
  the package. `npm pack --dry-run` should show ~48 files, ~294 KB unpacked.
- **`prepublishOnly: tsup`** rebuilds `dist` on publish so a stale build can't ship.
- `data/prices/**` is required at runtime (the CLI resolves it from
  `import.meta.url`) — never drop it from `files`.
- The `packed tarball smoke` e2e (`test/cli-e2e/built-cli.test.ts`) installs the
  real tarball and runs the bin against a fixture — trust it over eyeballing.

## Troubleshooting (errors actually seen)

- **`E403 … Two-factor authentication or granular access token …`** — the account
  needs a second factor. npm has retired new TOTP setups; add a **passkey/WebAuthn**
  (Account → Two-Factor Authentication → passkey; on a Mac that's Touch ID). Then a
  local `npm publish` opens a browser prompt. (Routine releases via the workflow
  skip this entirely — OIDC is exempt from 2FA.)
- **`E403 … Package name too similar to existing package ai-receipts`** — you tried
  the unscoped `aireceipts`. The package is `aireceipts-cli`; check `package.json`.
- **`remote rejected … without workflow scope`** on push — your git/OAuth token
  can't modify `.github/workflows/**`. Push workflow changes with a token that has
  `workflow` scope, or split them into a separate maintainer-pushed commit.
- **npm classic tokens don't exist** (revoked 2025-12) — if any old CI referenced
  `NODE_AUTH_TOKEN` with a classic token, it's dead. The only paths are OIDC
  (workflow) or a short-lived granular token for a one-off.

## First publish, for the record (v0.1.0, 2026-07-04)

Done manually because npm can't pre-register a trusted publisher for a
not-yet-existent package ([npm/cli#8544](https://github.com/npm/cli/issues/8544)):
`npm login` (passkey) → `npm publish` from clean `main`. v0.1.0 therefore carries
**no provenance attestation**; every release from v0.1.1 does, via the workflow.
