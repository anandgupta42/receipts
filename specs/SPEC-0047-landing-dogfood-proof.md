---
id: SPEC-0047
title: "Landing-page parity — the dogfood proof on the PR-receipt tile"
status: building
milestone: M5
depends: [SPEC-0021, SPEC-0046]
---

# SPEC-0047: Landing-page parity — the dogfood proof on the PR-receipt tile

## Purpose

SPEC-0046 put the dogfood proof — *this repo runs on it; every PR carries the receipt
of the sessions that built it* — on the README's first screen, because it is the one
claim no competitor can copy without copying the harness. The landing page
(`site/index.html`, SPEC-0021) is the other first-contact surface and does not make
that claim anywhere. This spec closes that single gap, inside the existing
"Receipts on your PRs" tile, without disturbing SPEC-0021's receipt-as-page design.
Invariants: **I6** (facts, no rankings — the added line states what this repo does,
never that it is better), **SPEC-0021 R5** (the page makes zero external requests —
this change adds text only, no assets, no script).

## Requirements

- **R1 — The dogfood proof on the PR-receipt tile.** The description paragraph of the
  tile at `site/index.html:361-368` gains one appended sentence (Design, verbatim)
  stating that this repo runs on it and every PR carries its receipt, linking the public
  PR list on GitHub. It is text + one anchor inside the **existing** `<p>` — no second
  paragraph (the `.scn` flex column has no `gap` and `.scn p` has `margin:0`, so a new
  sibling `<p>` would sit flush; folding into the description avoids any new CSS), no
  image, no script.
- **R2 — Guards stay green, page stays self-contained.** `node scripts/check-landing-css.mjs`
  passes (no new font-size or grid declarations are introduced), and
  `test/site-share.test.ts` stays green. The only new outbound link is to
  `github.com/anandgupta42/receipts/pulls` — a normal anchor, not a fetched resource,
  so R5's no-external-**requests** property is unchanged.

## Design (lead-authored, verbatim copy)

The tile's description paragraph gains a second sentence (the link inherits the page's
`a{color:inherit}` rule — muted gray with its default underline, keeping the accent
reserved per SPEC-0021). The tile becomes:

> **Receipts on your PRs**
> What the change cost to make — every agent counted. This page's repo runs on it —
> every PR carries its receipt.

Exact paragraph, verbatim (link text and href verbatim):

```html
<p>What the change cost to make — every agent counted. This page's repo runs on it — <a href="https://github.com/anandgupta42/receipts/pulls">every PR carries its receipt</a>.</p>
```

## Non-goals

- **Reordering the hero to lead with PR receipts.** SPEC-0021's page IS a session
  receipt end to end; forcing PR-first would fight the design. The README reordered a
  bullet list (SPEC-0046 R2); the landing page keeps its session-receipt narrative and
  gains the dogfood proof as the credibility line on the tile that already earns it.
- **Crediting ccusage on the landing page.** The ccusage differentiation lives in the
  README Related-work section and `docs/faq.md` (SPEC-0046 R3/R4) — where a
  comparison-shopping reader actually lands. The landing page is a 30-second conversion
  surface (SPEC-0021 Purpose); competitor copy there dilutes it. Recorded as a
  deliberate decision, not an oversight.
- **Any other landing-page copy edit** (hero, honesty band, closing bookend). This spec
  is one line; a broader landing refresh would be its own spec with a full design pass.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 line present | `site/index.html` PR-receipt tile | Design sentence present, verbatim, linking the PRs URL |
| R1 placement | tile at `site/index.html:361-368` | appended to the existing description `<p>`; no new `<p>`, no new CSS |
| R2 css guard | `node scripts/check-landing-css.mjs` | exit 0; no new font-size/grid declarations |
| R2 self-contained | `test/site-share.test.ts` + external-request scan | green; only new outbound link is the PRs anchor |
| R1 no ranking | added line | states what the repo does; no comparative/superlative words (I6) |

## Success criteria

- [ ] The dogfood line renders on the PR-receipt tile; the PRs link resolves.
- [ ] `node scripts/check-landing-css.mjs` passes; landing page issues zero external
      requests (text + anchor only).
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass unmasked
      (`echo $?`).

**Kill criterion:** if the tile cannot take the line without a new CSS rule or a layout
change (the CSS guard or a visual check fails), the copy is trimmed or the spec is
withdrawn rather than growing the page's style surface for one sentence.

## Validation

**2026-07-05 · S1 (self):** the gap is real and measured — `site/index.html` contains
"Receipts on your PRs" (`:363`) but no dogfood/self-hosting claim anywhere (grep for
"every PR", "runs on it" → zero hits on the current page). The change is text + one
anchor inside an existing `.scn` tile, reusing an existing class, so the CSS guard
(`scripts/check-landing-css.mjs`, font-size + grid only) and R5's no-external-requests
property are structurally unaffected. The ccusage and hero-reorder decisions are
recorded as deliberate non-goals with reasons.

**2026-07-05 · design adaptation (lead):** the original draft placed the proof as a
second `<p>`; `.scn` is a gapless flex column with `margin:0` on `.scn p`, so a sibling
would render flush. Rather than add a spacing rule (R2 forbids new CSS; the kill
criterion prefers trimming to growing the style surface), the proof folds into the
existing description paragraph as one appended sentence. Design + test matrix updated to
the shipped form so spec and page do not drift.

**2026-07-05 · approved (button 1):** maintainer, in-session ("approved"), folded into
PR #131 per the maintainer's stated preference. S2 (independent critic) waived under the
solo-session directive; the Codex delta review on #131 covers this change.
