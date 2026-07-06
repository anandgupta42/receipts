---
id: SPEC-0053
title: "PR-receipt-first README — the receipt on a merged PR is the first visual"
status: building
milestone: M5
depends: [SPEC-0029, SPEC-0048, SPEC-0050]
---

# SPEC-0053: PR-receipt-first README — the receipt on a merged PR is the first visual

## Purpose

SPEC-0048 put the dogfood claim — *this repo runs on it* — on the README's first
screen as a sentence. This spec upgrades the claim from a sentence to the first
**visual**: a real receipt comment on a merged PR of this repo, permalinked so any
reader can click through and verify it live. The PR comment is the one artifact a
teammate encounters *without installing anything* — it is the surface that recruits
the next user, so it should be the first thing a visitor sees. Alongside it: the
first-run path becomes four numbered steps (install → receipt → wire-in → PR
receipts, folding in SPEC-0050's `setup`), and the trust guarantees already stated
in prose become a scannable block. Serves **I3** (every number traceable — the
proof image links to its live source), **I5** (goldens still gate every fenced
receipt), and SPEC-0029's evidence note (`docs/internal/readme-evidence.md`:
visual in the first 30 lines in 86% of the winning corpus). Maintainer-directed
(2026-07-05); research report in the maintainer's vault, same date.

## Requirements

- **R1 — The PR receipt is the first visual.** Directly under the badges, the README
  shows a screenshot of a real `aireceipts pr --post` comment as it renders on a
  merged PR of this repo, wrapped in a link to that comment's permalink, with a
  caption naming it as a real, clickable comment. The image file is committed under
  `docs/assets/`. No fenced receipt text is added by this (fenced receipts remain
  golden-gated per SPEC-0029 R2/R4).
- **R2 — The session-receipt hero stays, relocated.** The golden-pinned
  `<picture>` (light + dark SVGs) moves to the "what you get back" position beside
  its byte-identical fenced golden, so SPEC-0029 R2's guard (hero sources resolve to
  committed golden SVGs) still holds.
- **R3 — Four-step first-run path.** The Install section presents exactly four
  numbered steps: (1) run `npx aireceipts-cli` (with `--demo` as the empty-machine
  branch, SPEC-0051), (2) `aireceipts setup` (SPEC-0050), (3) wire the always-on
  surfaces (hook / statusline), (4) put receipts on PRs (`pr --post` / CI caller).
  The `## Install` heading stays within the first 60 lines (SPEC-0029 R3).
- **R4 — Trust block, scannable.** The trust guarantees currently embedded in the
  "why this exists" prose render as a short bold-led bullet block above the fold:
  local-only, no accounts/servers; dollars only from cited dated price rows;
  deterministic byte-stable output; telemetry disclosed and killable. Links to
  `docs/trust.md` and `docs/telemetry.md` are preserved.
- **R5 — Watch hook, factual.** One line invites star/watch tied to a fact of this
  repo (price tables are re-verified and updated by CI as vendors change prices) —
  no superlatives, no rankings (I6).
- **R6 — Guards stay green.** `test/readme-guard.test.ts` passes unmodified in its
  existing assertions; new assertions added for R1 (proof image exists on disk;
  permalink is an anchored issuecomment URL on this repo). Hygiene, goldens,
  determinism, and spec-lint all pass.

## Scenarios

- **Given** a first-time visitor on the repo page, **When** they scroll past the
  tagline, **Then** the first image they see is a receipt comment on a real merged
  PR, and clicking it lands on that live comment.
- **Given** the README's fenced receipts, **When** the guard runs, **Then** every
  fenced receipt still byte-matches a committed golden (the screenshot adds no
  fenced text).
- **Given** an empty machine, **When** the reader follows step 1, **Then** the
  `--demo` branch shows a rendered receipt with nothing of theirs read.

## Non-goals

- **Changing the tagline / naming a category.** The tagline is byte-synced to
  `package.json` (SPEC-0029 R1) and is the maintainer's voice — any category-naming
  change is a separate maintainer-worded pass.
- **A hosted PR app.** SPEC-0052 parked it; the CI caller workflow
  (`docs/adopt/pr-receipt-check-caller.yml`) remains the recommended integration.
- **A GitHub Marketplace Action listing.** Requires maintainer-owned publish steps
  (marketplace listing, release tagging); deferred to its own spec.
- **Per-agent standalone doc pages.** `docs/guide/15-integrations.md` (SPEC-0050)
  already carries per-agent snippets; standalone pages are deferred until there is
  search-traffic evidence they earn their upkeep.
- **Animated/GIF hero.** The evidence note records 1-of-22 winners using animation;
  static, golden-pinned visuals stay.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 proof image committed | README image path under `docs/assets/` | file exists on disk (guard test) |
| R1 proof permalink | README link wrapping the image | matches `github.com/anandgupta42/receipts/pull/\d+#issuecomment-\d+` |
| R1/R6 fenced receipts unchanged | README fenced blocks containing the wordmark | each byte-matches a committed golden |
| R2 hero SVGs still present | `<picture>` srcs | ≥2 `goldens/svg/` paths, light + dark, on disk |
| R3 install position | `## Install` heading | within first 60 lines |
| R3 four steps | Install section body | exactly four numbered steps, `--demo` named in step 1 |
| R4 trust block | README above-the-fold text | bold-led bullets; `docs/trust.md` + `docs/telemetry.md` links preserved |
| R5 watch hook | README text | one star/watch line, tied to the price-scan fact, no superlatives |
| R6 length budget | README line count | ≤ 260 |
| R6 emoji budget | README emoji count | 0 |

## Success criteria

- [ ] R1–R6 implemented; readme-guard extended for R1 and green.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass unmasked
      (`echo $?`).
