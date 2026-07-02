---
id: SPEC-0022
title: "Docs site from repo markdown"
status: approved
milestone: M4
depends: [SPEC-0021]
---

# SPEC-0022: Docs site from repo markdown

Invariants: I1 (deterministic; zero model calls; zero product-path network), I3
(claims traceable to repo docs), I5 (generated output is byte-stable), I6 (facts,
never rankings). Approval basis: maintainer requested this build directly on
2026-07-02.

## Purpose

Publish the root `docs/*.md` files as static GitHub Pages HTML under `site/docs/`
without adding a docs framework, runtime dependency, workflow, or external asset
request. The docs pages inherit the SPEC-0021 landing site's receipt-certificate visual
system so the documentation feels like the same product surface while preserving I1's
local, deterministic build path.

## Requirements

- **R1** — `scripts/build-docs-site.mjs` reads only root-level `docs/*.md`, sorts them
  deterministically, and writes one matching `site/docs/<name>.html` page plus
  `site/docs/index.html`.
- **R2** — The markdown renderer is dependency-free and supports the subset the repo
  docs use: headings, paragraphs, fenced code blocks, tables, links, inline code,
  bold text, ordered lists, and unordered lists.
- **R3** — Every generated page uses the LANDING V3 token set, masthead, sheet layout,
  and footer language from SPEC-0021's `site/index.html`, with docs-local navigation.
- **R4** — Generated output is idempotent and deterministic: running the script twice
  with unchanged docs produces no diff.
- **R5** — Generated HTML makes no external load requests: no remote scripts, styles,
  fonts, images, iframes, CSS imports, or CSS `url(http...)` references.
- **R6** — The landing page's docs link is relative (`docs/index.html`) so GitHub Pages
  can serve docs with no workflow change once the landing PR is live.

## Scenarios

- **Given** the six root markdown docs **When** `node scripts/build-docs-site.mjs` runs
  **Then** `site/docs/index.html` links to every source file and each doc has a
  same-named HTML page.
- **Given** markdown tables with escaped pipe characters **When** docs are rendered
  **Then** cells stay in the intended columns and inline code is HTML-escaped.
- **Given** a committed `site/docs/` tree **When** the build script runs twice **Then**
  `git diff -- site/docs` stays empty after the second run.
- **Given** the generated docs HTML **When** it is scanned for remote resource loads
  **Then** none are present.

## Non-goals

- No docs framework, bundler, client-side router, search index, syntax highlighter, or
  new npm dependency; the site stays static and dependency-free.
- No recursive publishing of `docs/spikes/**`; this spec intentionally publishes only
  root `docs/*.md` as the public docs set.
- No rewriting the docs' factual content or adding marketing copy; the generator wraps
  existing repo docs and converts their markdown structure.
- No Pages workflow change; generated files are committed under `site/docs/` for the
  existing Pages artifact.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 root docs | `find docs -maxdepth 1 -name '*.md'` | each file appears in `site/docs/index.html` and has a matching `.html` |
| R2 markdown subset | docs headings, code fences, tables, links, lists | rendered HTML has semantic headings, `pre/code`, `table`, `a`, `ol`, `ul` |
| R2 escaped cells | `docs/json-schema.md` table rows with `\|` | escaped pipes remain inside cells, not split columns |
| R3 visual system | generated page source | V3 tokens (`--field`, `--sheet`, `--ink`, `--ledger`) and masthead/footer classes present |
| R4 idempotence | run script twice | second run leaves no `git diff -- site/docs scripts/build-docs-site.mjs` output |
| R5 no external requests | generated HTML grep | no remote `script/link/img/iframe/srcset`, CSS `@import`, or CSS `url(http...)` loads |
| R6 relative landing link | `site/index.html` | footer docs link is `href="docs/index.html"` |
| gates | repo root | full verification block passes unmasked with `echo $?` after each command |

## Success criteria

- [ ] `node scripts/build-docs-site.mjs`; `echo $?` passes and writes `site/docs/`.
- [ ] `site/docs/index.html` contains every root `docs/*.md` source path and link.
- [ ] Generated docs HTML has no external resource loads.
- [ ] Re-running `node scripts/build-docs-site.mjs` leaves generated output unchanged.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, determinism, spec-lint, and hygiene all pass
      unmasked with `echo $?`.
