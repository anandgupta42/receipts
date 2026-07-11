---
id: SPEC-0080
title: "Landing SEO + AEO: absolute share cards, structured data, sitemap, llms.txt"
status: building
milestone: M5
depends: [SPEC-0021, SPEC-0025, SPEC-0079]
---

# SPEC-0080: landing SEO + AEO

Invariants: I1/I4 (no NEW executable script and no NEW page-initiated fetch on any page —
the landing already ships its copy-button JS and R3's JSON-LD is an inert
`type="application/ld+json"` data block; crawler files are plain text), I3 (structured
data and llms.txt state only facts verifiable in the repo — no ratings, no invented
numbers), I6 (no model/agent rankings in any description). I2/I5 untouched — no receipt
bytes change.

## Purpose

The maintainer asked whether the landing (`anandgupta42.github.io/receipts/`) is SEO- and
AEO-ready (directive, 2026-07-10). Audit: partially. Present — `<title>`, meta
description, OG/twitter tags, `lang`. Broken — `og:image`/`twitter:image` are **relative**
(`site/index.html:12,14`); the OG/Twitter-card specs require absolute URLs, so link
previews cannot resolve the image today (markup defect, verifiable from the spec'd
formats; no analytics claim implied). Missing — canonical, `og:url`, JSON-LD,
`robots.txt`, `sitemap.xml`, `llms.txt`; and `site/samosa.html` — the page built to be
shared — has no OG tags at all. This spec ships the fixes as static bytes, pinned by
tests rather than generators (Codex S2 killed the generator design: `hygiene` gates only
`site/docs`, and the docs builder's link guard rejects absolute `<link href>`s).

**Kill criterion:** zero NEW executable scripts and zero NEW page-initiated fetches on
any page (a crawler fetching the OG image is not the page fetching); JSON-LD carries no
field unverifiable from the repo (`aggregateRating` and kin are banned by test). If a
consumer requires fabricated fields, it is not served.

## Requirements

- **R1 — absolute share URLs on the landing.** `site/index.html`: `og:image` and
  `twitter:image` become exactly
  `https://anandgupta42.github.io/receipts/assets/hero-receipt.png` (asset exists —
  `site/assets/hero-receipt.png`, asserted by test); add canonical
  `https://anandgupta42.github.io/receipts/` and matching `og:url`.
- **R2 — samosa share card.** The samosa image is committed as
  `site/assets/samosa-card.jpg` (≤120KB, asserted); `site/samosa.html` gains
  `og:title` (`buy me a samosa`), `og:description` (the page's lede sentence, byte-equal
  to the `<p class="lede">` text), absolute `og:image`, `og:url`, `twitter:card`
  `summary_large_image`, `twitter:image`, and canonical. The SPEC-0079 R1 contract is
  refined, not weakened: zero `<script>`, no page-initiated external fetch (`src=` still
  data-URI only), and exactly two **anchor** links (`<a href="https` — Wikipedia, Ko-fi);
  the contract test's raw `href="https` count (which canonical would trip) switches to
  anchor counting. SPEC-0079 gets a one-line amendment recording this refinement.
- **R3 — JSON-LD on the landing.** Exactly one `application/ld+json` block:
  `SoftwareApplication` — `name: aireceipts`, `applicationCategory:
  DeveloperApplication`, `operatingSystem: "macOS, Linux, Windows"`, `offers: { price:
  "0", priceCurrency: "USD" }` (the npm install is free — `package.json` has no paid
  gate; `license` Apache-2.0 `LICENSE` URL), `url` = the landing, `codeRepository` =
  `https://github.com/anandgupta42/receipts`, `description` byte-equal to the page's
  meta description. Field allowlist enforced by test; `aggregateRating`/`review` keys
  banned by test.
- **R4 — crawler files, static + test-pinned.** `site/robots.txt`: `User-agent: *`,
  `Allow: /`, absolute `Sitemap:` line. `site/sitemap.xml`: a checked-in static file
  listing the landing, `samosa.html`, and every `site/docs/*.html`; **a test derives the
  expected URL set from the `site/docs` directory listing and asserts exact equality**,
  so adding/removing a docs page fails CI until the sitemap is updated (staleness gated
  by test, not by a generator). No `<lastmod>` (nothing deterministic to put there).
- **R5 — `llms.txt` for answer engines.** `site/llms.txt` per the llmstxt.org convention
  (the shape GPTBot/ClaudeBot/PerplexityBot-era crawlers consume): H1 `aireceipts`, a
  blockquote summary drawn from the landing's meta description, then sections linking the
  docs index, key docs pages (getting started, PR receipts, trust/telemetry), the GitHub
  repo, and the samosa page — each with a one-line factual description. A test asserts
  every relative link resolves to a shipped file and every absolute link stays on the
  two known hosts (github.com repo, the Pages origin).
- *(Deferred — recorded, not built: per-docs-page `<meta description>`/canonical needs a
  second excerpt extractor in `build-docs-site.mjs` and a docs-index decision; parked
  until the docs surface is next touched. Codex S2 finding accepted.)*

## Scenarios

- **Given** `site/index.html`, **then** og:image/twitter:image/og:url/canonical equal the
  exact absolute URLs above, and exactly one JSON-LD block parses with the R3 allowlist.
- **Given** `site/samosa.html`, **then** the R2 tag set is present, the page still has
  zero `<script>` tags, and exactly two `<a href="https` anchors.
- **Given** `site/sitemap.xml` and the `site/docs/*.html` listing, **then** the URL sets
  are equal (plus landing + samosa), and `robots.txt` names the sitemap.
- **Given** `site/llms.txt`, **then** every link resolves (relative → shipped file;
  absolute → known hosts only).

## Non-goals

- **Analytics, Search Console verification, trackers** — I4; and therefore no claims
  about ranking/traffic outcomes anywhere in this spec.
- **Fabricated structured data** — banned keys tested (I3).
- **Sitemap `<lastmod>` / generator integration** — static + test-pinned instead.
- **Per-docs-page descriptions/canonicals** — deferred (see R-list).
- **`view.html` in the sitemap** — artifact-viewer chrome, not a landing destination.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 exact urls | site/index.html | the four head URLs byte-equal the spec'd absolute URLs |
| R1 asset exists | site/assets/hero-receipt.png | file exists |
| R2 tag set | site/samosa.html | og:title/og:description/og:image/og:url/twitter:card/twitter:image/canonical present; og:description byte-equal to the lede |
| R2 card asset | site/assets/samosa-card.jpg | exists; ≤120KB |
| R2 contract kept | site/samosa.html | zero `<script>`; no external `src=`; exactly two `<a href="https` anchors |
| R3 json-ld | landing | exactly one ld+json block; parses; `@type` SoftwareApplication; fields ⊆ allowlist; no `aggregateRating`/`review` |
| R3 honesty | ld+json description | byte-equal to the meta description |
| R4 robots | site/robots.txt | `User-agent: *` + `Allow: /` + absolute `Sitemap:` |
| R4 sitemap parity | sitemap vs `site/docs/*.html` listing | exact URL-set equality + landing + samosa; no `<lastmod>` |
| R5 llms links | site/llms.txt | every relative link → shipped file; absolute links on known hosts only |
| Kill criterion | all touched pages | no new `<script>` beyond the one inert ld+json data block; no new external `src=`/fetch |

## Success criteria

- [ ] Landing and samosa share cards carry absolute image URLs; samosa unfurls with the
      maintainer's card image.
- [ ] JSON-LD, robots.txt, sitemap.xml, llms.txt ship, each pinned by its test.
- [ ] SPEC-0079 contract amendment recorded; its tests green with anchor counting.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass unmasked
      (`echo $?`).

## Validation

**2026-07-10 · S1 (self):** first draft claimed "links unfurl broken" as observed fact and
"all pages script-free" — both corrected (the defect claim is now grounded in the OG/
Twitter format requirement for absolute URLs; the landing already ships copy-button JS,
so the invariant is "no NEW executable script").

**2026-07-10 · S2 (Codex, read-only): REWORK → reworked.** Accepted: the false
script-free claim (fixed, kill criterion reworded); missing matrix rows (exact-URL
equality, asset existence, twitter tags, JSON-LD allowlist + honesty row, kill-criterion
row — all added); the sitemap-generator design was infeasible as written (`hygiene`
gates only `site/docs`; `--out` semantics; the docs builder's guard rejects absolute
`<link href>`) — replaced with a **static sitemap pinned by a parity test**, which also
answers the "cannot go stale is unsupported" objection with an enforced gate; R6
(per-docs descriptions) deferred exactly as argued (separate excerpt extractor, visible-
copy risk); SPEC-0079 needs its own contract amendment for anchor counting — added to
R2. Partially rejected: *cut R5/defer all AEO* — the maintainer's directive today was
explicitly "SEO **and AEO** compatible", so R3–R5 stay, but each now carries a
verifiable gate (allowlist, parity, link-resolution) instead of outcome claims, and the
staleness objection is met with tests. Codex's "smallest slice R1+R2" is recorded as the
fallback if the maintainer wants to trim.

**2026-07-10 · S3 (worth):** **Who + how often:** R1/R2 — every share of the landing or
samosa link (the samosa page exists to be shared; broken unfurls directly blunt the
maintainer's stated viral bet). R3–R5 — every crawler visit; AEO surfaces are exactly how
answer engines will describe the tool. **Do-nothing:** share cards stay broken (R1 is a
defect, not an enhancement); answer engines guess. **Smaller fix:** absolute-URLs-only —
rejected by the maintainer's explicit AEO ask. **Kill dry-run:** the criterion (no new
scripts/fetches, no unverifiable JSON-LD fields) is enforced by matrix rows. **Verdict:
build now** (maintainer-directed; mechanism de-risked per S2).

**2026-07-10 · S4 (lint):** pass.

**2026-07-10 · approved (button 1, in-session):** the maintainer's directive ("have you
made this page seo and aeo compatible") is the build ask; scope corrections welcome as
with SPEC-0079's amendment history.
