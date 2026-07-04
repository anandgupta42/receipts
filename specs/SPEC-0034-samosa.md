---
id: SPEC-0034
title: "The samosa — a clickable link, an honest glyph, a small delightful page"
status: shipped
milestone: M4
depends: [SPEC-0027, SPEC-0029]
---

# SPEC-0034 · the samosa

Invariants: I1/I5 (all receipt surfaces are golden-gated; the footer change
churns every golden deliberately, once), I3/I6 (a product about honest
labels must not ship a mislabeled glyph), I4 (the samosa page is
self-contained, zero trackers, zero third-party requests).

## Purpose

Two maintainer directives (2026-07-03). **(a)** The footer signature exists
to celebrate the samosa — the maintainer's favorite snack — and should be a
**clickable** invitation on surfaces that support clicks (it never can be on
the terminal receipt). **(b)** The current glyph is wrong: `🥟` (U+1F95F) is
named DUMPLING in Unicode, and Unicode has **no** samosa emoji (verified:
searching U+1F300–U+1FAFF for SAMOSA/PASTRY returns nothing; the nearest are
DUMPLING and PIE). For a tool whose entire premise is that every character
on a receipt is true, shipping a dumpling labeled "samosa" is the one
mislabel we cannot keep. This spec fixes the glyph, adds a real drawn samosa
for graphical surfaces, and gives the link a small home.

**Kill criterion:** (a) the swap must be **width-neutral** — `🔺` occupies
the same cell count as the outgoing `🥟` on every terminal template, so no
footer's alignment shifts; a glyph that changes cell width, or a plain-text
footer that unbalances the centered masthead, reverts to text-only; (b) the
golden churn is one-shot — if the same footer needs a second churn within
the release window, the footer text/glyph freezes until after launch (churn
fatigue erodes the golden gate's signal).

## Requirements

- **R1 — Terminal footer: an honest shape, not a wrong food.** Replace
  `🥟` with `🔺` (U+1F53A, RED TRIANGLE — a samosa is triangular; a shape
  evokes without asserting the falsehood a dumpling does) at **every**
  hardcoded site (the critic found three): the `FOOTER_EMOJI` constant
  (`src/receipt/present.ts:36`, `src/pr/body.ts:56`, feeding classic +
  datavis + the PR body) AND the standalone footer in
  `src/receipt/week.ts:112`. `grocery` has no glyph footer
  (`present.ts:302`) — untouched. It is a **width-neutral swap**: `🔺` and
  the outgoing `🥟` are both East-Asian-Wide (2 cells), so the footer's
  cell count is unchanged — this spec does not claim the footer is 50
  display columns (it never was: `center()` counts code points, so the
  emoji footer is 50 code points / 51 display cells — a PRE-EXISTING
  condition, not introduced here). `FOOTER_TEXT` unchanged. Deliberate
  one-commit golden churn (I5). *(Design records `buy me a samosa`
  text-only as the fallback if the maintainer rejects a glyph.)*
- **R2 — A real samosa for graphical surfaces.** A committed inline SVG
  glyph `src/receipt/samosa-glyph.ts` (a small hand-authored triangular
  samosa path, brand-neutral, no external refs) rendered in the SVG
  exporter footer (`src/receipt/svg.ts`), the artifact page footer
  (`src/pr/html.ts`), the site footer, and the samosa page. Graphical
  surfaces can draw what Unicode won't; the terminal can't, hence R1's
  shape. Golden-gated wherever it lands in an SVG golden.
- **R3 — The clickable link, on clickable surfaces only.** A markdown/HTML
  link to the samosa page on: the README license/footer area
  (`docs/adopt`-adjacent — respects the guard's emoji + length caps), the
  artifact page footer, the viewer chrome footer (`site/view.html`, OUTSIDE
  the sandboxed iframe), the site footer, and the PR-comment **details
  section footer** (`src/pr/body.ts` details assembly — a markdown link,
  the one place in the comment that renders links; the fenced receipt stays
  link-free by nature). Never on the terminal receipt. The link text is
  `buy me a samosa`; the destination is R4.
- **R4 — The samosa page (`site/samosa.html`).** Small, self-contained
  (inline CSS, the R2 SVG, zero scripts, zero third-party requests, no
  analytics — same contract as `view.html`), matching the site aesthetic.
  It celebrates the samosa and tells the true story ("Unicode has no samosa
  emoji, so we drew one") — the honest-labels ethos as a delight, not a
  donation ask. **No payment mechanism** ships by default; the page carries
  a clearly-marked, commented-out placeholder block the maintainer can fill
  with a real link later — a decision recorded, not made here.
- **R5 — The README guard survives the churn.** The fenced golden receipt
  in README changes bytes (footer glyph); `test/readme-guard.test.ts` must
  stay green — re-verify: the emoji cap counts title `🧾` + the receipt's
  footer glyph = 2 (`🔺` is in the guard's `\u{1F300}-\u{1FAFF}` range, so
  the count is unchanged at 2). The README's hero receipt and text receipt
  are regenerated from the new goldens in the same PR (the guard forces
  this — SPEC-0029's whole point).

## Scenarios

- **Given** any terminal receipt after R1, **then** the footer reads
  `aireceipts · local · buy me a samosa 🔺`, centered, ≤ 50 cols.
- **Given** the SVG export, **then** the footer shows the drawn samosa
  glyph, not an emoji.
- **Given** a posted PR comment, **then** the details section ends with a
  `buy me a samosa` markdown link; the fenced receipt has none.
- **Given** the samosa page, **then** it loads with zero network requests
  and no payment ask.
- **Given** the README after regeneration, **then** the guard is green and
  the emoji count is exactly 2.

## Non-goals

- **A payment/donation integration** — the motivation is samosa awareness,
  not fundraising; only a commented placeholder ships.
- **Per-surface glyph variation beyond R1/R2** — one terminal shape, one
  drawn SVG, nothing bespoke.
- **Animating or theming the samosa page** — small and static.
- **Changing `FOOTER_TEXT`** — only the glyph and the new links.
- **A terminal-clickable footer** — OSC 8 hyperlinks are unsupported by too
  many terminals and would break byte-determinism; the link lives on
  graphical/markdown surfaces (R3).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 glyph swap | any terminal receipt | footer ends `buy me a samosa 🔺` |
| R1 width | every template footer | ≤ 50 cols, centered (kill criterion a) |
| R1 all surfaces | grep shipped receipts incl. week | no `🥟`; `🔺` in classic/datavis/PR/week footers; grocery untouched |
| R1 width-neutral | footer cell widths | `🔺` cell count == outgoing `🥟` on every template |
| R1 golden churn | `verify-goldens` after regen | `*.txt` + `mini/*.txt` + `svg/*.svg` + `html/pr-artifact.html` updated in one commit; determinism ×10 stable |
| R2 svg glyph | SVG export | drawn samosa present; no `🥟`/`🔺` in SVG footer |
| R3 comment link | posted body | details footer has `buy me a samosa` markdown link; fence has none |
| R3 no terminal link | terminal receipt | no link/URL bytes |
| R4 page self-contained | site/samosa.html | zero `http(s)://` fetches, zero `<script>`, no analytics |
| R4 no payment | samosa page | payment affordance present only inside an HTML comment |
| R3 README link | README | `buy me a samosa` link present; guard still green |
| R3 viewer chrome | site/view.html | link in chrome OUTSIDE the sandboxed iframe |
| R3 site footer | site/index.html | samosa link + drawn glyph |
| R5 guard green | README after regen | guard 9/9; emoji count == 2 |
| R5 no dumpling anywhere | repo grep | `🥟` absent from shipped surfaces (glyph replaced everywhere) |

## Success criteria

- [x] `🥟` appears nowhere on a shipped surface; `🔺` (terminal) and the
      drawn SVG (graphical) replace it; the samosa page loads offline.
- [x] Golden churn is a single reviewed commit with the regeneration
      explained; determinism ×10 stable.
- [x] README guard green after regeneration (emoji count 2).
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass
      unmasked (`echo $?`).

## Validation

**2026-07-03 · S1 (self):** the emoji facts are verified against Unicode,
not asserted (U+1F95F = DUMPLING; no SAMOSA codepoint; U+1F53A =
RED TRIANGLE, East-Asian-Wide). The brand argument is load-bearing: a
receipt tool cannot ship a mislabeled glyph. Payment stays out by decision,
not omission.

**2026-07-03 · S2 (Codex, read-only): REWORK → reworked.** Findings:
1 (emoji facts) — verified and cited. 2 (R1 missed `week.ts` + grocery)
BLOCKER — **accepted**; R1 now enumerates all three hardcoded sites and
excludes grocery. 3 (50-column claim false — code points vs display cells)
BLOCKER — **accepted**; reframed to a **width-neutral swap** (🔺 == 🥟 cell
count), the pre-existing 50cp/51-cell condition named honestly, kill
criterion a rewritten. 4 (golden scope missed mini + html) HIGH —
**accepted**; full churn set enumerated. 5/6 (missing surface rows;
concrete PR link seam) HIGH — **accepted**; matrix rows for README/viewer-
chrome/site added, PR link pinned to the post-`</details>` link area with
budget accounting. 7 (scope creep) MED — **acknowledged**; kept as one
spec per the maintainer's combined directive, but the page + payment
placeholder are isolated in R4 so they can ship as a second commit if the
glyph fix wants to land alone. 8 (unverifiable R4 aesthetic) LOW —
**accepted**; replaced with network/script/comment assertions.

**2026-07-03 · S3 (value gate):** the churn is the risk; kill criterion b
caps it at one. The glyph fix (R1/R2/R5) is independently valuable and
testable without the page; the page (R3/R4) is the delight layer.

**2026-07-03 · S4 (lint):** spec-lint OK.

**2026-07-03 · approved (button 1):** maintainer, in-session ("all specs
approved"). Glyph + no-payment confirmations recorded on PR #76.

**2026-07-04 · S5 (build, gates + live walk):** all 7 gates green, unmasked
(`echo $?`): `tsc` 0, `eslint --max-warnings 0` 0, `vitest run` 0 (985 tests,
84 files), `verify-goldens` 0 (90 artifacts byte-identical), `determinism-check
--runs=10` 0 (10/10 byte-identical), `spec-lint` 0 (32 specs), `hygiene` 0.
Golden churn: 53 files, one shot — `git diff --stat` shows 57 insertions/56
deletions, confirming a width-neutral swap in terminal/mini goldens plus
additive (not destructive) glyph-group markup in SVG goldens, nothing else
touched. Added the missing R3 test (`test/pr/body.test.ts`) asserting the
samosa link closes the `<details>` section while the fenced receipt stays
link-free. Walked all 4 success criteria live against the built CLI: terminal
receipt prints `🔺` (not `🥟`); `--svg` export contains zero emoji codepoints
and exactly one drawn-glyph `<g>` matching the R2 path; `site/samosa.html`
has zero external URLs (the sole `http://` match is the inert `xmlns` SVG
namespace) and zero `<script>` tags; README guard's 9 tests green post-regen.

**2026-07-04 · S6 (Codex code review, commit `64d0c3e`):** verdict REWORK,
3 findings, all accepted and fixed in a follow-up commit. (1) High —
`site/samosa.html` still rendered `🥟` in its prose ("DUMPLING (🥟,
U+1F95F)"), violating the R5 "no dumpling on shipped surfaces" matrix row;
fixed to "DUMPLING (U+1F95F)" (the Unicode fact stays, the emoji goes), and
the `samosa-glyph.ts` comment's `🥟` was reworded the same way. (2) Medium —
the glyph path is duplicated in `site/samosa.html`, `site/view.html`,
`site/index.html`, and `scripts/build-docs-site.mjs` rather than sourced from
the module; static HTML and a plain `.mjs` build script cannot import the TS
module, so the duplication itself stays, but a new drift-guard test
(`test/receipt/svg.test.ts`) now pins every inlined copy byte-identical to
the module's three `<path>` literals. (3) Medium — the README emoji guard
asserted `<= 2` while R5 pins exactly 2; tightened to exact identity
(`["🧾", "🔺"]`) plus exact count. Codex's `vitest`/`verify-goldens` failures
were read-only-sandbox artifacts (Vite temp dir + `mkdtemp` blocked), not
real: both re-ran green locally before and after the fixes.

**2026-07-04 · merge note (origin/main, post-#79):** the intended base
branch's PR (#79) merged while this spec was in review, so this branch
merged `origin/main` and now targets `main` directly. One textual conflict
(`src/pr/body.ts`): #80's ledger-table header vs R3's samosa-link frame —
resolved by keeping both (table up top, samosa link still closes the
section); goldens auto-merged and re-verified byte-identical, no regen
needed. One matrix deviation: R5 said README "emoji count == 2" (title 🧾 +
footer 🔺), but #78 replaced the title emoji with the wordmark image after
this spec was approved — the exact-identity guard now pins the intentional
set to just `["🔺"]`.
Post-merge gates: `tsc` 0, `eslint` 0, `verify-goldens` 0 (90 artifacts),
`determinism-check --runs=10` 0, `spec-lint` 0 (35 specs), `hygiene` 0.
`vitest` is 999/1001: the two failures are upstream #69 stress tests
("100 generated opencode combinations", "100 simulated opencode sessions")
timing out on this loaded dev machine — reproduced byte-for-byte on a clean
`origin/main` worktree with zero SPEC-0034 changes, so they are
pre-existing environment timeouts, not regressions; CI arbitrates.

**2026-07-04 · maintainer: 🔺 rejected ("not a samosa") — text-only fallback
activated; Unicode has no samosa emoji and this product does not print
approximations.** Terminal/PR/week footers now render exactly
`aireceipts · local · buy me a samosa`, centered by the same `center()`
math (no hand padding; the line is 2 display columns narrower). The
footer block's `emoji` field became `samosaMark` — a drawn-glyph request
graphical renderers honor and terminal output ignores; the SVG/artifact
samosa glyph stays (it IS a samosa). Golden churn: one shot via
`goldens.mts --update`, 37 files (39 insertions / 39 deletions —
terminal/mini/html footers only; `svg/` goldens untouched). README fenced
receipt re-synced to golden bytes; guard emoji assertion tightened from
`["🔺"]` to exact `[]`. Repo-wide sweep: no `🔺` remains on any shipped
surface (the two survivors are an internal evidence doc row, updated, and
a negative test assertion). Side effect: `build-docs-site.mjs` now throws
on manifest gaps and `NAV_SECTIONS` was missing `trust.md` +
`adopt/org-rollout.md` (pre-existing on `origin/main`, blocked this
regen) — both added to the nav.

**2026-07-04 · shipped:** merged via #91; ledger sweep pre-release.
