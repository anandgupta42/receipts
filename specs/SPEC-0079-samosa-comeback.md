---
id: SPEC-0079
title: "The samosa story page: a live tip jar, on the project's own surfaces only"
status: building
milestone: M5
depends: [SPEC-0034, SPEC-0070]
---

# SPEC-0079: the samosa story page

Invariants: I4 (the story page stays self-contained — zero scripts, zero trackers, works
offline except the one outbound link), I5 (no receipt or golden byte changes — this spec
touches no shipped receipt surface). I1/I2/I3/I6 untouched — no product-path change of any
kind; the tip affordance is never a dollar figure.

## Purpose

The maintainer wants the samosa story told and the tip jar real — but **only on the
project's own surfaces**: the story page, the README, the landing page, the docs site, and
the repo's Sponsor button (directive, 2026-07-10, correcting an earlier in-session answer
that had asked for a PR-surface reversal — see Validation). SPEC-0070's off-by-default on
PR-posted surfaces **stands**; every *default* posted surface stays byte-identical. (One
deliberate exception, per Codex's implementation review: an *opt-in* `--samosa` artifact
footer renders the R5-redesigned glyph, because the glyph is single-sourced — same link,
same layout, new paths.) What changes: `site/samosa.html` becomes the love-of-samosa story — why a samosa
and not a coffee, the kept honest-glyph Unicode story, and only at the end "still want to
buy me one?" — pointing at the maintainer's now-live Ko-fi jar
(`https://ko-fi.com/anandgupta42`, created and supplied in-session 2026-07-10; Ko-fi
bot-blocks automated fetches, so the URL is maintainer-attested — the page's current
`github.com/sponsors` href is dead: GraphQL `hasSponsorsListing: false`). The README gets
its `buy me a samosa` link back; FUNDING.yml's single row is the story page (R3, amended).

**Kill criterion:** the story page keeps exactly **two** external hrefs — the Wikipedia
samosa article and the Ko-fi jar — and zero `<script>` tags; the photo is embedded in the
page (data URI), never fetched. If the story rewrite ever needs a tracker, a script, an
external image fetch, or a third external reference, that variant is dead. And the
no-PR-surface-change claim is enforced, not promised: the SPEC-0070 default-off suite and
the artifact golden must pass untouched.

## Requirements

- **R1 — the story page.** `site/samosa.html` is rewritten to the Design section's copy —
  reduced to byte assertions: the page contains the Design lede and love-story sentences
  verbatim, and the Ko-fi href appears **last** among hrefs before the relative back link
  (ask-last). The SPEC-0034 Unicode-story prose is **removed** (maintainer directive,
  2026-07-10: "I don't like the unicode thing"). A samosa image sits under the lede:
  **maintainer-supplied and AI-generated** (chosen after two rejected rounds of Wikimedia
  candidates), recompressed and embedded as a `data:image/jpeg` URI (~90KB — the page
  stays self-fetching-free). Honest-labels rule: the caption says what it is —
  `rendered by AI — the real ones get eaten too fast to photograph` — and the page never
  fabricates a photographer credit; a descriptive `alt` is required. The
  word *samosa* in the love story links to
  `https://en.wikipedia.org/wiki/Samosa`. Contract otherwise unchanged from SPEC-0034 R4:
  inline CSS, the drawn SVG kept as the brand mark, its three `<path>` literals
  byte-identical to `src/receipt/samosa-glyph.ts` (exactly what the existing drift-guard
  in `test/receipt/svg.test.ts` pins — wrapper `<svg>` attrs differ by design), zero
  `<script>`, no analytics. External hrefs: exactly two — Wikipedia and the Ko-fi tip link
  (`https://ko-fi.com/anandgupta42`), replacing the dead `github.com/sponsors` href.
- **R2 — README link restored.** README currently has no samosa link (SPEC-0034 R3's link
  was dropped in a later README rework). A text-only `buy me a samosa` markdown link to the
  published samosa page (`SAMOSA_URL`, `src/pr/publish.ts:22`) returns in the
  footer/license area; the readme-guard suite (`test/readme-guard.test.ts`, currently 11
  tests) stays green and gains one assertion: README contains
  `[buy me a samosa](<SAMOSA_URL>)`. The link adds zero emoji; the intentional-emoji set
  stays exact `[]`.
- **R3 (amended 2026-07-10, post-merge) — the Sponsor block offers only the story page.**
  `.github/FUNDING.yml` carries exactly one entry: the `custom:` samosa-page URL. The
  originally-shipped `ko_fi:` row was removed at the maintainer's directive after seeing
  the rendered sidebar ("don't want two links — just the main samosa page link"): the page
  mediates the tip jar on every surface, which is the kill criterion's own logic extended
  to the Sponsor block. No direct payment-platform row (`ko_fi`/`github`/etc.) may return.
- **R4 — the existing own-surface links are pinned, not trusted.** The landing page
  (`site/index.html:484`), the viewer chrome (`site/view.html:62`), and the docs-site
  footer template (`scripts/build-docs-site.mjs:820`) already link `samosa.html`; a small
  static test asserts each keeps a `samosa.html` href, so a future rework can't silently
  drop the maintainer's chosen surfaces the way the README rework did (R2's motivating
  incident).
- **R5 — the glyph grows up.** The maintainer rejected the smiley triangle ("come up with
  something better") and picked the **hot & fresh** design from a rendered four-option
  gallery: crimped pastry base + two steam wisps, no face. `src/receipt/samosa-glyph.ts`'s
  `PATH` becomes the four new `<path>` literals (body, crimp wave, two steam curls); every
  inlined static copy (`site/samosa.html`, `site/view.html`, `site/index.html`,
  `scripts/build-docs-site.mjs` + its regenerated `site/docs/*` output) is updated in the
  same commit — the existing drift-guard derives the expected paths from the module, so it
  enforces the propagation automatically. **Zero golden churn:** SPEC-0055 removed the
  glyph from receipt SVGs, and the default artifact footer is link-free (SPEC-0070), so no
  golden contains the glyph — `verify-goldens` must pass with no regeneration.

## Scenarios

- **Given** `site/samosa.html` after the rewrite, **then** it has zero `<script>` tags and
  exactly one external href — the Ko-fi link, after the story in document order — and its
  inlined glyph paths are byte-identical to the module's three `<path>` literals.
- **Given** the README after the edit, **then** the readme-guard suite passes, including
  the new assertion that the `buy me a samosa` link targets `SAMOSA_URL`.
- **Given** `aireceipts pr --post` (default), **then** the comment and artifact bytes are
  unchanged by this spec — no samosa link appears (SPEC-0070's tests and the artifact
  golden pass untouched); with opt-in `--samosa`, the artifact footer carries the same
  single link with the R5 glyph paths.
- **Given** the repo's GitHub page, **then** the Sponsor button offers exactly one row —
  the samosa-page link (the page carries the Ko-fi ask).

## Non-goals

- **Flipping SPEC-0070's PR-surface default** — explicitly declined by the maintainer at
  button 1 (2026-07-10). `--samosa` remains the only way a posted receipt carries the link.
- **A `--no-samosa` flag, payload changes, golden churn, or new telemetry** — all were in
  the pre-correction draft and died with the reversal; no CLI or product-path surface
  changes, so SPEC-0043's telemetry-with-every-feature rule has nothing to attach to.
- **A direct Ko-fi link anywhere but the story page** — README, landing, viewer, docs,
  and (post-amendment) the Sponsor block all link the story page; the page mediates the
  payment link.
- **The terminal receipt card** — plain install footer, unchanged (SPEC-0055).

## Design — the story page copy (lead-authored; implementer executes, never invents)

Card structure (existing aesthetic — monospace, paper card, drawn glyph on top):

1. **glyph:** the drawn triangle, smaller (44px) — brand mark, not hero.
2. **h1:** `buy me a samosa`
3. **lede:** "Every open-source project asks you to buy the maintainer a coffee. Not this
   one. I want a samosa."
4. **the image (hero):** the maintainer's AI-rendered samosas, full card width, rounded
   4px, `alt="Golden samosas on a plate, one broken open to show the spiced potato and
   pea filling, with green and tamarind chutneys"`, honest caption beneath in 10.5px
   muted: `rendered by AI — the real ones get eaten too fast to photograph`.
5. **the love story:** "aireceipts runs on my favorite snack on earth: the
   [samosa](https://en.wikipedia.org/wiki/Samosa) — and I genuinely believe it is the
   best snack ever made. Coffee has enough sponsors. This page exists to spread samosa
   awareness." *(the "raise samosas" pun and the "crisp, honest triangle" clause were cut
   at the maintainer's round-3 pass — the fact block now carries the description).*
6. **fact block (dl — teaches a stranger what a samosa is):** `the shell` → "thin pastry
   folded into a triangle, fried until it crackles"; `the filling` → "spiced potato &
   peas — cumin, coriander, green chili"; `the dip` → "tamarind or mint chutney".
7. **the ask (last, after a rule):** "Read this far and still want to buy me one?" →
   link text `chip in for a samosa →`, href `https://ko-fi.com/anandgupta42`. No status
   badges.
8. **back link:** `← back to aireceipts` (relative, unchanged).
9. **the glyph paths (R5, module-sourced):** body
   `M22 10 L38.5 39.5 Q40 42 37 42 H7 Q4 42 5.5 39.5 Z`, crimp
   `M9.5 37 q2.2 -2.8 4.4 0 t4.4 0 t4.4 0 t4.4 0 t4.4 0 t4.4 0`, steam
   `M32 12 q3 -3 1 -6` and `M38 17 q3 -3 1 -6`.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 page contract | site/samosa.html | zero `<script>`; exactly two external hrefs (Wikipedia, Ko-fi); photo is a `data:image/jpeg` URI with non-empty `alt` |
| R1 copy + order | page bytes | Design lede + love-story strings present verbatim; Ko-fi href is the last href before the back link; no Unicode-story prose (`U+1F95F` absent) |
| R1 honest caption | page bytes | `rendered by AI —…` caption present; no `photo:` credit fabricated |
| R1 glyph drift | inlined SVG `<path>` literals | byte-identical to `samosa-glyph.ts`'s paths (existing guard, path-count-agnostic) |
| R5 glyph module | `samosa-glyph.ts` | four Design-section paths; no face paths remain |
| R5 propagation | site html + docs template/output | drift guard green; no old paths anywhere (repo grep) |
| R5 zero churn | `verify-goldens` | passes with no golden regenerated |
| R2 README | README bytes | `[buy me a samosa](SAMOSA_URL)` present; guard suite green; emoji set exact `[]` |
| R3 funding | `.github/FUNDING.yml` | the `custom:` samosa-page entry only; no payment-platform rows |
| R4 surface pins | index.html, view.html, build-docs-site.mjs | each carries a `samosa.html` href |
| PR surfaces untouched | SPEC-0070 suite + `verify-goldens` | default comment/artifact link-free; `pr-artifact.html` golden byte-identical |

## Success criteria

- [ ] The story page ships the Design copy: zero scripts, one external href (the live
      Ko-fi jar), glyph paths drift-guarded.
- [ ] README and FUNDING.yml carry their links; readme-guard green with the new assertion.
- [ ] No PR-posted surface changes: SPEC-0070 tests and all goldens pass untouched.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass unmasked
      (`echo $?`).

## Validation

**2026-07-10 · S1 (self, on the pre-correction draft):** two dishonesty risks caught
pre-critic: the Design copy asserted an invented biographical fact ("nights and weekends" —
cut) and hardcoded an unclaimed Ko-fi handle (flagged; resolved when the maintainer created
the jar mid-review). All remaining claims are locally checkable: link presence/order, href
counts, guard bytes.

**2026-07-10 · S2 (Codex, read-only, on the pre-correction draft): REWORK → reworked.**
The draft then also flipped SPEC-0070's default (`--no-samosa`, payload polarity, golden
churn, telemetry). Findings on the surviving scope, all **accepted**: Design copy reduced
to verbatim-string + document-order byte assertions; "SVG byte-identical" reworded to the
three `<path>` literals the drift guard actually pins; readme-guard count corrected (11,
not 9) and the missing link assertion added. Findings on the flip (old-ref render path via
`postRef.ts:13`, size-cap regression row, parser/telemetry seam citations) were folded,
then **mooted by the scope correction below**. Codex's worth attack argued the reversal
should not ship as one feature; its "tip destination isn't real" blocker was resolved
in-session (`ko-fi.com/anandgupta42` created by the maintainer).

**2026-07-10 · S3 (worth, post-correction):** **Who + how often:** every visitor to the
repo README, landing page, and docs — the project's public face — plus anyone who clicks
`Sponsor`. **Recurring:** the page is linked from every own-surface footer today; its tip
href has been dead since SPEC-0034 shipped (a `github.com/sponsors` URL with no listing
behind it). **Do-nothing:** the story stays untold and the only tip affordance on any
surface points at a dead link — worse than no link. **Smaller fix:** this *is* the smaller
fix — Codex's S2 worth attack proposed exactly this subset ("update the existing page only
after a real destination is claimed"), and the maintainer's correction landed on it.
**Steelman the cut:** a marketing-copy change needs no spec; but the page is a
golden-adjacent shipped surface with a self-containment contract, and the README is
guard-gated — the spec is the cheap way to keep those contracts explicit. **Kill dry-run:**
one external href, zero scripts — asserted by the new page-contract test. **Verdict: build
now.**

**2026-07-10 · S4 (lint):** `node scripts/spec-lint.mjs` — pass.

**2026-07-10 · approved (button 1) with scope correction:** the maintainer reviewed the
full-reversal preview (artifact) and directed: *"no I don't want it in every receipt — I
just want in the github page, readme and the landing page and the docs page."* The
PR-surface reversal (draft R1–R4, R8) is cut; SPEC-0070 stands; the surviving scope
(story page, README, FUNDING, surface pins) is the directive. Recorded as in-session
approval per SPEC-0034 precedent.

**2026-07-10 · button-1 amendment (visual pass on the preview):** three directives folded
into R1/Design: **(a)** a real samosa photo — *Two samosas with chutney on red triangular
plate* (Xenocarcinus, CC BY-SA 4.0, Wikimedia Commons), chosen over a CC0 candidate that
was too dark to be appetizing; embedded as a data URI so the page stays fetch-free, visible
text credit satisfies attribution without a third link; **(b)** a Wikipedia link on the
word *samosa* "for people to know what a samosa is"; **(c)** the Unicode honest-glyph
prose is cut ("I don't like the unicode thing") — the drawn glyph itself stays (drift
guard + brand mark), only the story about it goes. Kill criterion updated: exactly two
external hrefs.

**2026-07-10 · button-1 amendment 2 (round-3 visual pass):** five more directives, all
folded: **(a)** the receipt-card/this-page fact block ("what does this even mean?") is
replaced by shell/filling/dip — it now teaches a stranger what a samosa is; **(b)** the
"raise samosas" pun is cut for the plain sentence; **(c)** the preview-only `KO-FI · LIVE`
badge is removed everywhere; **(d)** the first photo was rejected ("bad image") — the
maintainer picked **A, the levitating samosa** (Tapas Kumar Halder, CC BY-SA 4.0) from a
five-candidate Commons gallery; **(e)** the smiley glyph was rejected ("come up with
something better") — the maintainer picked **hot & fresh** (crimp + steam) from four
rendered options → R5. The "link on the GitHub About sidebar" ask is satisfied by R3:
FUNDING.yml renders the *Sponsor this project* block there.

**2026-07-10 · S5 (build, gates + live walk):** all 7 gates green, unmasked (`echo $?`):
`tsc` 0, `eslint --max-warnings 0` 0, `vitest run` 0 (1877 tests, 137 files — includes the
new `test/samosa-page.test.ts` 12-case contract suite and the readme-guard link
assertion), `verify-goldens` 0 with **zero regeneration** (R5's zero-churn claim held:
no golden contains the glyph), `determinism-check --runs=10` 0, `spec-lint` 0 (74 specs),
`hygiene` 0 (docs site regenerated via `npm run docs:site`, 25 pages). Side effects
handled: the SPEC-0055 negative test anchored on the old glyph path — its anchor now
derives from `samosaGlyphMarkup()` so a redesign can never leave it asserting against a
retired glyph; the drift-guard path count updated 3 → 4.

**2026-07-10 · button-1 amendment 3 (the image):** the round-2 Wikimedia pick (levitating
samosa) was rejected too; a four-candidate round-3 gallery was published, and the
maintainer chose to supply their own image instead — an AI-generated render (steaming
samosas, one broken open, both chutneys — it illustrates the fact block exactly). Honesty
handling: no photographer credit is fabricated; the caption states `rendered by AI — the
real ones get eaten too fast to photograph`, keeping the honest-labels ethos on the one
surface a skeptic would check. No license/attribution obligation attaches.

**2026-07-10 · S6 (Codex code review, commit `81a7c5e`): REWORK → reworked, 2 findings.**
(1) *Accepted as a spec-wording fix:* "no PR-posted surface changes by one byte"
over-claimed — an opt-in `--samosa` artifact footer does pick up the R5 glyph (the glyph
is single-sourced by design); Purpose and the scenario now say "default surfaces
byte-identical, opt-in glyph intentionally updated". Default artifact golden verified
unchanged. (2) *Accepted as a test fix:* the drift guard's per-path `contains` couldn't
prove completeness or the absence of the retired face marks; it now pins the full adjacent
path **sequence** and asserts the two legacy path prefixes are absent from every inlined
copy. Codex otherwise verified: zero golden churn (102 artifacts), all 25 regenerated docs
pages carry the four new paths, no old glyph or sponsors URL remains shipped.

**2026-07-10 · button-1 amendment 4 (post-merge, the Sponsor block):** after enabling the
Sponsorships toggle and seeing the sidebar render two rows, the maintainer directed:
*"don't want two links — just the main samosa page link."* The `ko_fi:` row is removed from
FUNDING.yml (follow-up PR); the R3 test now asserts the custom entry is the only row and
no payment-platform key can silently return. Consistent with the kill criterion: the story
page is the only door to the tip jar, now including the Sponsor block.

**2026-07-10 · button-1 amendment 5 (post-merge, README placement):** the maintainer's
rationale, recorded verbatim in intent: the README samosa link is the viral bet — "it has
a chance of going viral because not many people ask for it." The License-area afterthought
("Support the project: …") is replaced by a dedicated closing `## Buy me a samosa` section
carrying the quotable subversion line ("Every open-source project asks you to buy the
maintainer a coffee. Not this one — buy me a samosa, and I'll explain."). R2's guard
assertion (lowercase `[buy me a samosa](SAMOSA_URL)`) still pins the link; line count 247
of the guard's 260 cap (trailing newline counts); badge row untouched.
