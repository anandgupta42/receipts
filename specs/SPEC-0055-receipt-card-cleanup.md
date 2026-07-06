---
id: SPEC-0055
title: "Receipt card cleanup — drop the samosa footer + methodology brief, samosa link goes real"
status: approved
milestone: M4
depends: [SPEC-0020, SPEC-0034]
---

# SPEC-0055 · receipt card cleanup

Invariants: I3 (every number traceable — the methodology stays one flag away,
just not printed on the card by default), I5 (all receipt surfaces are
golden-gated; this spec churns every golden deliberately, once), I4/I6
unaffected.

## Purpose

Maintainer directive, in-session 2026-07-05, for GTM readiness (three
requirements, verbatim): **(1)** remove "buy me a samosa" from the receipts;
**(2)** make buy-me-a-samosa real, with a link for it; **(3)** remove the
methodology brief footnote from the receipt ("Per-turn cost split evenly
across that turn's tool calls; unpriced models show tokens only, never
guessed dollars. Full method: `aireceipts --methodology`"). The receipt card
is the product's first impression for a GTM push; a snack joke and a
three-line footnote are noise on that surface. The samosa itself isn't
going away — it moves to where it always could be clicked, and gets a real
destination instead of a commented-out placeholder. This supersedes
SPEC-0020 R3's exact-wording assertion (the methodology footnote is no
longer part of the "honesty battery" — the receipt no longer carries a
verbatim methodology footnote to check) and SPEC-0034 R2 for the
**receipt-card surface only** (the drawn samosa glyph no longer renders on
the receipt's SVG export) — SPEC-0020 and SPEC-0034 are left as unedited
historical record; this spec is the amendment going forward.

**Kill criterion:** the golden churn is one-shot — regenerate every golden
in a single commit via `verify-goldens.mjs --update`, `determinism-check
--runs=10` stable, no second churn within this PR.

**Amendment (maintainer decision, in-session 2026-07-05, follow-up on PR
#145):** the footer becomes `aireceipts · local · npx aireceipts-cli`
(39 columns, within the ≤50-col centered constraint). Rationale: receipts
circulate on public PRs, so the footer carries the shortest true install
CTA; the terminal stays link-free. R1 below is read with this text. This
amendment adds one more golden regen commit on the PR branch — the
one-shot kill criterion applies per decision, not across amendments.

## Requirements

- **R1 — Footer text loses the samosa, everywhere the receipt card renders
  it.** `FOOTER_TEXT` becomes `"aireceipts · local · npx aireceipts-cli"`
  (per the Amendment above; the directive's original wording was
  `"aireceipts · local"`) at all three hardcoded sites: `src/receipt/present.ts:35` (feeds classic + datavis), `src/pr/body.ts:61`
  (feeds the fenced receipt in the PR comment), `src/receipt/week.ts:112`
  (the standalone weekly-digest footer, not part of the `Block` AST). `grocery`
  never had the samosa in its footer (`THANK YOU FOR VIBING WITH...`,
  `present.ts:312`) — untouched. `--mini`/`--handoff` output carries no
  footer text of its own — verified no change needed. This also retires the
  `samosaMark` field on the `footer` Block kind (`src/receipt/blocks.ts`)
  end to end, since nothing sets it to `true` anymore: the field is dropped
  from the type, its two push sites (`present.ts` `buildClassic`/`buildDatavis`)
  drop the property, and the SVG renderer's glyph-drawing branch
  (`src/receipt/svg.ts`, the `if (block.samosaMark)` block in the `"footer"`
  case of `layoutBlock()`) is deleted along with the `samosaStroke` `Paints`
  field, its assignment in `paintsFor()`, and the now-unused
  `SAMOSA_STROKE_DARK`/`SAMOSA_STROKE_LIGHT`/`samosaGlyphGroup` imports.
  `src/receipt/samosa-glyph.ts` itself is NOT deleted — it remains the single
  source for the surfaces R3 keeps.
- **R2 — Methodology brief footnote removed from the card; full methodology
  stays one flag away.** Drop the `{ kind: "footnote", text: METHODOLOGY_BRIEF,
  spaceBefore: true }` push from `tailBlocks()` (`present.ts:251`, shared by
  classic/datavis) and from `buildGrocery()` (`present.ts:311`). Delete the
  now-fully-dead `METHODOLOGY_BRIEF` constant from `src/pricing/attribution.ts`
  (the full `METHODOLOGY` constant is untouched — it still feeds the
  `aireceipts --methodology` flag and `AttributionResult.methodology`, which
  ships unabridged in `--json`). Remove the `missing-methodology` violation
  code and its `hasMethodology` check from `validateReceiptBlocks()`
  (`src/receipt/blocks.ts`) — a priced receipt no longer carries an exact
  methodology footnote to validate against; the other four violation codes
  (`dollar-in-unpriced`, `untraced-dollar`, `missing-delta-note`,
  `waste-label-drift`) are unaffected. The generic `"footnote"` Block kind
  itself is NOT removed — it stays as a stable AST extension point (unused by
  any current template after this change, same as before this spec for some
  templates). `src/cli/commands/demo.ts`'s own "method: aireceipts
  --methodology" pointer is not a receipt-card block — left as-is.
- **R3 — Samosa stays real and clickable on every non-receipt surface.**
  Unchanged, verified, in two forms. Plain markdown links, text only, no
  drawn glyph: README's license line (`README.md:180`) and the PR-comment
  details-section link (`src/pr/body.ts` `SAMOSA_LINK` at line 415, rendered
  by `detailsSection()` — the fenced receipt above it loses the footer text
  per R1, the details section below keeps the link unchanged). Drawn-glyph
  + link pairs: the site footer (`site/index.html`), the PR artifact page
  footer (`src/pr/html.ts:104`, via `samosaGlyphMarkup`), `site/view.html`
  chrome, `site/samosa.html` itself, and the docs-site footer template
  (`scripts/build-docs-site.mjs`'s `wrapPage()` at line 773). `src/receipt/
  samosa-glyph.ts`'s `samosaGlyphMarkup` function is consumed only by
  `src/pr/html.ts` and (until R1) `src/receipt/svg.ts` — the four static
  HTML surfaces each carry their own hand-duplicated inline copy of the
  same `<path>` markup (a pre-existing duplication this spec does not
  change); only the receipt-card SVG consumption (R1) stops importing the
  shared function.
- **R4 — Samosa made real: a working link on the samosa page.** Replace the
  commented-out payment placeholder in `site/samosa.html` (the block
  starting `<!-- No payment mechanism ships by default (SPEC-0034 R4
  non-goal...`) with a real, visible link:
  `<p class="chip"><a href="https://github.com/sponsors/anandgupta42">chip in for a samosa &rarr;</a></p>`,
  styled with one small inline `.chip` CSS rule added to the page's existing
  `<style>` block — no scripts, no third-party requests, matching the page's
  existing self-contained contract (same constraint SPEC-0034 R4 set). The
  page's prose (the `<p class="lede">`/`<p>` pair and the `<dl class="fact">`
  terminal-vs-graphical explanation) is reworded for accuracy: the receipt
  card no longer says or draws samosa anywhere (R1); "everywhere else" (site,
  artifact chrome, docs footer, the samosa page) still draws the real glyph
  and still links here. **Non-goal, recorded for the maintainer:** GitHub
  Sponsors is not yet enabled for `anandgupta42` (verified 2026-07-05) —
  enabling it is a maintainer action outside this PR's scope; the link is
  the agreed destination regardless of current enablement state.
  `.github/FUNDING.yml` is untouched.
- **R5 — AGENTS.md I3 amended to match the new contract.** Replace the
  clause "the receipt prints its attribution methodology" (AGENTS.md, I3)
  with "the attribution methodology is one flag away (`--methodology`) and
  ships in `--json`" — a minimal wording change, no other edits to I3 or any
  other invariant. AGENTS.md stays at or under its CI-capped 150-line
  budget; the "Current-state inventory" section is untouched.
  **Note:** `specs/SPEC-0000-product.md`'s own I3 clause carries the same
  stale wording ("the receipt prints its attribution methodology") — the
  maintainer directive scoped this amendment to AGENTS.md only, so
  SPEC-0000 is left as-is; reconciling it is a follow-up for the maintainer
  to decide (SPEC-0000 is the constitution and isn't edited casually).
- **R6 — Golden churn, one shot, plus every dependent doc re-synced.** Run
  `node scripts/verify-goldens.mjs --update` once; the churn touches
  `goldens/*.txt`, `goldens/svg/*.svg`, `goldens/html/*.html` (`goldens/mini/*.txt`
  is unaffected — `--mini` output has no footer/methodology text). Re-sync
  README's fenced receipt (`README.md`) to the new golden bytes —
  `test/readme-guard.test.ts` enforces this. Update every embedded receipt
  example in `docs/guide/01-getting-started.md`, `04-read-a-receipt.md`,
  `05-compare.md`, `06-week.md`, `10-templates.md` (drop the footer's samosa
  clause and the methodology-brief lines from each fenced block), then
  regenerate `site/docs/*.html` via `node scripts/build-docs-site.mjs` so the
  static docs site matches.
- **R7 — Tests updated to match the new contract.** `test/receipt/svg.test.ts`'s
  "R2 drawn samosa glyph" describe block is replaced with assertions that no
  template's receipt SVG carries the glyph's anchor path or a raw
  🥟/🔺 codepoint; its static-surface glyph-pinning describe block (README/
  site/view/docs-footer) is unchanged (those surfaces still draw it per R3).
  `test/receipt/templates.test.ts` drops its `METHODOLOGY_BRIEF` import and
  its exact-footnote assertion (replaced with an assertion that no
  `"footnote"` block is present on a priced classic receipt), and its
  `validateReceiptBlocks` "has teeth" test drops the now-impossible
  `missing-methodology` tamper scenario while keeping the
  `dollar-in-unpriced`/`untraced-dollar` scenarios. `test/pr/body.test.ts`
  and `test/pr/artifact.test.ts` need no changes — both files' samosa
  assertions target the KEEP surfaces (R3), orthogonal to this churn.

## Scenarios

- **Given** any terminal receipt (classic/datavis) after R1, **then** the
  footer reads `aireceipts · local · npx aireceipts-cli`, centered, no
  methodology footnote above it (R2).
- **Given** the SVG export, **then** the footer shows plain text only — no
  drawn samosa glyph, no emoji.
- **Given** `aireceipts --methodology`, **then** the full methodology prints
  unabridged, unaffected by this spec; **given** `--json`, **then**
  `model.methodology` is still the full string.
- **Given** a posted PR comment, **then** the fenced receipt's footer has no
  samosa clause and no methodology footnote; the details section still ends
  with the `buy me a samosa` markdown link.
- **Given** the samosa page, **then** it shows a real, visible sponsor link,
  loads with zero network requests, and its prose accurately describes that
  the receipt itself no longer references the samosa in any form.
- **Given** the README after regeneration, **then** the guard is green and
  the fenced receipt matches golden bytes exactly.

## Non-goals

- **Enabling GitHub Sponsors for `anandgupta42`** — a maintainer action;
  this spec only wires the link to the agreed destination (R4).
- **Touching `.github/FUNDING.yml`** — explicitly out of scope (R4).
- **Retroactively editing SPEC-0020 or SPEC-0034** — historical specs record
  what shipped at the time; this spec supersedes their receipt-card-specific
  requirements going forward without rewriting them.
- **Reconciling SPEC-0000's stale I3 wording** — flagged (R5) but deferred
  to the maintainer; only AGENTS.md is amended here.
- **Removing the generic `"footnote"` Block kind** — it stays as a stable
  AST extension point even though no current template builder uses it after
  this change.
- **Deleting `src/receipt/samosa-glyph.ts`** — still the single source for
  every surface R3 keeps.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 footer text | every terminal template's footer | `aireceipts · local · npx aireceipts-cli` (39 cols), no samosa clause |
| R1 all hardcoded sites | grep shipped receipts incl. week | no `buy me a samosa` in `present.ts`/`body.ts`/`week.ts` footer strings |
| R1 samosaMark removed | `Block` "footer" kind, `present.ts` push sites, `svg.ts` | field/branch/Paints entry/imports all gone |
| R1 SVG no glyph | `renderReceiptSvg` every template, light+dark | no glyph anchor path, no 🥟/🔺 bytes |
| R2 no footnote on card | `buildReceiptView` blocks, priced model | no `"footnote"` block present |
| R2 `--methodology` intact | CLI flag | full `METHODOLOGY` text prints unabridged |
| R2 `--json` intact | JSON output | `model.methodology` is the full string |
| R2 validator updated | `validateReceiptBlocks` | no `missing-methodology` code exists; other 4 codes still fire correctly |
| R3 KEEP surfaces unaffected | README/PR-details (text link) + site/artifact/view/samosa page/docs footer (glyph+link) | both forms present, unchanged |
| R4 real link | `site/samosa.html` | visible `<a href="https://github.com/sponsors/anandgupta42">` outside any comment |
| R4 self-contained | `site/samosa.html` | zero `<script>`, zero third-party requests |
| R5 AGENTS.md amended | I3 clause | old sentence gone, new wording present, file ≤150 lines |
| R6 golden churn | `verify-goldens.mjs` after regen | `*.txt`/`svg/`/`html/` updated in one commit; `mini/*.txt` untouched; determinism ×10 stable |
| R6 README re-sync | `test/readme-guard.test.ts` | green, fenced receipt byte-matches golden |
| R6 docs site rebuilt | `site/docs/*.html` | matches updated `docs/guide/*.md` content |
| R7 svg.test.ts rewritten | glyph-absence describe block | passes for classic/grocery/datavis, light+dark |
| R7 templates.test.ts updated | footnote assertion + has-teeth test | passes without `METHODOLOGY_BRIEF` import |
| R7 pr tests unaffected | `test/pr/body.test.ts`, `test/pr/artifact.test.ts` | pass unmodified |

## Success criteria

- [x] "buy me a samosa" appears nowhere on a receipt-card surface (terminal,
      SVG, PR fenced receipt, week digest); the methodology brief footnote
      is gone from every template; `--methodology`/`--json` are unaffected.
- [x] The samosa page carries a real, visible GitHub Sponsors link.
- [x] Golden churn is a single reviewed commit; determinism ×10 stable.
- [x] AGENTS.md I3 amended, file still ≤150 lines, inventory section untouched.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass
      unmasked (`echo $?`).

## Validation

**2026-07-05 · approved (button 1):** maintainer directive, in-session —
three requirements as stated in Purpose; SPEC-0053 is taken by open PR #141
and SPEC-0054 by another live session, so this spec uses id 0055.
