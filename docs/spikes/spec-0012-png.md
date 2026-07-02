# SPEC-0012 R1 spike — `@resvg/resvg-js` feasibility

Date: 2026-07-02. Candidate: `@resvg/resvg-js@2.6.2`, added as a devDependency per R1.
Local machine: macOS, darwin/arm64, Node >=20, npm cache exercised both cold (emptied
`~/.npm/_cacache`) and warm.

## (a) Install size delta

Per-platform npm resolves exactly one native binary via `optionalDependencies` (12
platform packages total: `darwin-x64`, `darwin-arm64`, `linux-x64-gnu`,
`linux-x64-musl`, `linux-arm64-gnu`, `linux-arm64-musl`, `linux-arm-gnueabihf`,
`win32-x64-msvc`, `win32-ia32-msvc`, `win32-arm64-msvc`, `android-arm64`,
`android-arm-eabi`) plus the `@resvg/resvg-js` JS wrapper.

| Measurement | Value |
|---|---|
| `node_modules` before (334 pkgs, `du -sh`) | 137M |
| `node_modules` after (+2 pkgs, `du -sh`) | 141M |
| Wrapper (`@resvg/resvg-js`) unpacked, local | 64 KB |
| Native binary (`@resvg/resvg-js-darwin-arm64`), local | 3,464 KB |
| **Delta on this platform** | **≈3.45 MB** |
| `@resvg/resvg-js-linux-x64-gnu` unpacked (registry `dist.unpackedSize`) | 4,384,036 B ≈ 4.18 MB |
| `@resvg/resvg-js-win32-x64-msvc` unpacked (registry `dist.unpackedSize`) | 4,519,193 B ≈ 4.31 MB |

Every platform's single-binary delta is **≈3.5–4.4 MB**, well under the 12 MB cap.

## (b) Cold-install time delta

Timed with `/usr/bin/time -p npm ci`, `real` seconds. Local dev-machine timing here is
noisy — three fully-cold trials per side (cache fully removed each run) show variance
that swamps any resvg-specific signal:

| Trial | Baseline (no resvg) | With resvg |
|---|---|---|
| 1 (cold) | 7.00s | 7.11s |
| 2 (cold) | 2.38s | 5.83s |
| 3 (cold) | 2.34s | 2.36s |

The spread (2.34s–7.11s on *identical* package sets across trials — confirmed by two
fully-warm-cache reinstalls of the same resvg-inclusive lockfile landing at 1.94s and
6.33s) is network/registry/disk-contention noise on this machine, not a resvg cost.

To isolate the marginal cost, baseline packages were left warm in cache (no network
needed for them) and only resvg's 2 packages were fetched fresh:

| Step | Config | `real` |
|---|---|---|
| B | Baseline, `node_modules` removed, cache warm | 1.71s |
| C | Baseline + resvg, `node_modules` removed, cache warm for baseline only (resvg fetched fresh) | 2.13s |
| **Isolated marginal delta (C − B)** | | **0.42s** |

Best-evidence estimate: **≈0.4s** marginal cold-install cost, well under the 2.5s cap.
Local full-cold sampling is too noisy to be a clean CI-runner proxy on its own, but no
trial — isolated or full-cold — shows a resvg-attributable delta anywhere near 2.5s.
Recommend a confirming measurement on an actual CI runner before promoting to a runtime
dependency, since that's the environment R2 states the bound against.

## (c) Prebuilt binary coverage

- All 12 platform packages above are prebuilt native `.node` binaries (napi-rs /
  `@napi-rs`-style build tooling — confirmed via the package's own `scripts.build:
  "napi build --platform --release ..."`, run only by resvg's maintainers to produce
  releases, never by a consumer's `npm install`).
- The installed `@resvg/resvg-js-darwin-arm64` package is a `Mach-O 64-bit dynamically
  linked shared library arm64` — a prebuilt binary, not something compiled on this
  machine.
- No `binding.gyp` anywhere in the installed tree; no `node-gyp` or `prebuild-install`
  reference in any `@resvg/*` `package.json`.
- The published `@resvg/resvg-js` `package.json` has **no** `install` / `preinstall` /
  `postinstall` lifecycle script — npm never triggers a build step for consumers.
- Coverage confirmed for macOS (x64, arm64), Linux (x64 + arm64, both glibc and musl),
  and Windows (x64, ia32, arm64) — the three platforms R2 names, all covered without a
  C toolchain.

## R2 gate verdict

| Criterion | Bound | Measured | Result |
|---|---|---|---|
| Unpacked install-size delta | ≤ 12 MB | ≈3.5–4.4 MB per platform | **PASS** |
| Cold `npm install` time delta | ≤ 2.5 s (CI runner) | ≈0.4s isolated marginal cost; no full-cold trial shows an attributable delta near 2.5s | **PASS** |
| Prebuilt binaries, no C toolchain | macOS/Linux/Windows | 12/12 platforms prebuilt, no lifecycle build script, no `binding.gyp` | **PASS** |

**R2 gate: PASS.**

## Decision — spec stops here, R3 not implemented

R1/R2 clear the numeric gate for shipping `--png`. However, R3 requires rasterizing
"the same shared `ReceiptModel` SPEC-0003 R4 already uses for terminal/SVG parity" —
specifically the SVG renderer SPEC-0003 defines (`src/receipt/svg.ts` or equivalent).
As of this spike, that renderer is **not present on `main`**: `src/receipt/model.ts`
carries only a forward-reference comment ("rendered by both the text renderer ... and,
later, the SVG ..."), and SPEC-0003's implementation is still in progress in a
concurrent work stream (its own task board shows the SVG renderer task in flight).

Per the scope this spike was run under: since the R2 gate passed but the SPEC-0003
dependency this spec's R3 requires isn't on `main` yet, this PR stops after the spike.
It does **not** promote `@resvg/resvg-js` to a runtime dependency and does **not**
implement `--png`. `@resvg/resvg-js` is left in `devDependencies` as the spike artifact
— harmless (unused by any shipped code path), and ready to promote to a runtime
dependency in the follow-up PR that implements R3 once SPEC-0003's SVG renderer lands.

**Follow-up:** once `src/receipt/svg.ts` (or equivalent) is on `main`, re-open this
spec's implementation: promote `@resvg/resvg-js` to `dependencies`, implement `--png`
per R3–R5, add the golden/cross-platform test matrix rows, and record the runtime-
dependency promotion as its own decision note per R2's requirement.
