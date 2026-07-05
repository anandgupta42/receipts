---
id: SPEC-0048
title: "Positioning pass — work-unit receipts lead the README, plus an end-user FAQ"
status: building
milestone: M5
depends: [SPEC-0025, SPEC-0029]
---

# SPEC-0048: Positioning pass — work-unit receipts lead the README, plus an end-user FAQ

*Numbering note: renumbered from 0046 to 0048 on 2026-07-05 — while this branch
was open, 0045 landed as the discovery-load-failure spec (#128) and 0046 as the
rejected `pr-backfill` spec (#133). The side-session ID-collision pattern recurs
because `spec-lint` checks structure only, not duplicate ids across filenames; a
duplicate-id check is worth adding.*

Invariants: **I5** (every receipt shown in README stays byte-pinned to a golden; the
guard budgets in `test/readme-guard.test.ts` are caps this spec must fit inside),
**I2/I3** (FAQ answers about dollars restate the real rules — tokens-only without a
cited price row, estimates labeled as estimates — and never soften them), **I4** (the
telemetry answer mirrors `docs/telemetry.md` exactly; if they disagree, that is a bug),
**I6** (comparisons with other tools state facts about what each reads and prints,
never rank them).

## Purpose

Maintainer direction (2026-07-05): the README currently reads as a session-cost tool
first; the thing no other tool does — **the receipt attached to a unit of work, proven
by this repo's own PRs** — appears only in Contributing. Reorder the public surface so
work-unit receipts lead, credit adjacent tools plainly, and answer the questions real
users ask (how is this different from ccusage; I'm on a flat plan, why dollars; does it
phone home; why tokens and no dollars) in one question-first FAQ. Everything stated must
be derivable from committed repo bytes or the committed docs — **no internal strategy,
launch material, or unverifiable market claims anywhere in user-facing docs.**

## Requirements

- **R1 — The dogfood proof moves to the first screen.** One sentence (Design, verbatim)
  is added at the end of the README "Why this exists" paragraph, linking
  `docs/pr-receipts.md`. Tagline, hero, badges, and install position are untouched;
  all `readme-guard` budgets stay green (`README.md` is 154 lines against the 260 cap).
- **R2 — "What you get" leads with the PR receipt.** The existing PR-receipts bullet
  (README.md:88-90) moves to the top of the list, wording unchanged except the Design
  edit; the per-session anatomy bullet follows it. No bullet is added or removed.
- **R3 — Related work credits ccusage directly.** The Related-work paragraph
  (README.md:138-142) gains one sentence (Design, verbatim) crediting ccusage as the
  usage-dashboard standard in its own right — today it is only mentioned parenthetically
  as claude-receipts' data source. Factual, generous, no comparative adjectives (I6).
- **R4 — `docs/faq.md`, question-first.** A new FAQ with exactly the eight questions in
  Design. Each answer: ≤10 lines, links the one canonical doc that owns the topic
  (`docs/telemetry.md`, `docs/trust.md`, `docs/guide/13-pricing.md`,
  `docs/guide/12-troubleshooting.md`, `docs/internal/harness.md`,
  `docs/guide/14-session-attribution.md`), and makes no claim that cannot be traced to
  committed repo bytes. Vendor billing/pricing behavior is referenced only via the
  tool's own mechanics (price tables, `--quota`, `--methodology`) — never as claims
  about what a vendor charges or will charge.
- **R5 — Discoverability.** README's Docs section links the FAQ;
  `docs/guide/01-getting-started.md` links it; `docs/guide/12-troubleshooting.md` and
  `docs/faq.md` cross-link with a one-line statement of the split (symptom-first vs
  question-first). The docs-site build (`scripts/build-docs-site.mjs`, SPEC-0025)
  renders `faq.html` and it appears in the site nav.
- **R6 — The FAQ carries a content tripwire.** A doc test (`test/faq-doc.test.ts`,
  mirroring `test/trust-doc.test.ts`) pins: the file exists; all eight Design questions
  are present as headings; every relative link resolves to a committed file; and none
  of the internal-strategy tripwire strings appear (case-insensitive): `Show HN`,
  `Hacker News`, `launch window`, `GTM`, `funnel`, `objection`, `competitor`. The
  tripwire is a guard against drift, not a claim of completeness.

## Design (lead-authored, verbatim copy)

R1 sentence, appended to "Why this exists":

> This repo runs on it: every pull request here carries the receipt of the agent
> sessions that built it — open any merged PR and read the bill
> ([how](docs/pr-receipts.md)).

R2 bullet order: PR receipts → per-tool anatomy → waste lines → cheaper-model line →
exports. The PR-receipts bullet keeps its floors sentence unchanged.

R3 sentence, appended to Related work:

> [ccusage](https://github.com/ryoppippi/ccusage) is the standard for daily and weekly
> usage dashboards across coding agents; aireceipts answers a different question — what
> a specific session or PR cost, with every number traceable.

R4 — the eight questions, verbatim headings, with what each answer must contain:

1. **"How is this different from ccusage or my agent's built-in `/usage`?"** — both are
   usage dashboards over time; aireceipts is a receipt for a unit of work (a session, a
   PR) with per-tool attribution, cited prices, and byte-deterministic output. Links
   the ccusage repo directly (README section links don't survive the site's flat
   basename rewrite) + `docs/trust.md`. States facts about what each reads/prints; no
   ranking or quality adjectives (I6).
2. **"I'm on a flat-rate subscription — what do the dollar figures mean for me?"** —
   dollars are API-equivalent arithmetic from your real token counts (labeled, never a
   bill); `--quota` shows the window that actually constrains a subscriber; waste lines
   and per-tool anatomy are plan-independent. Links `docs/guide/13-pricing.md` and the
   quota row in README's table.
3. **"Does aireceipts send anything off my machine?"** — restates the telemetry tl;dr
   only: on by default, fixed nine-event catalog, never content/paths/dollars,
   `--telemetry-show` prints the exact payload and sends nothing,
   `AIRECEIPTS_TELEMETRY=off` / `DO_NOT_TRACK=1` mean zero network calls. Links
   `docs/telemetry.md` as the authoritative source.
4. **"Can I trust the numbers? Could someone fake a receipt?"** — a receipt is the
   author's disclosure, verifiable in its arithmetic, not cryptographic evidence;
   floors when attribution is incomplete; reconciliation and caveats make fabrication
   visible, not impossible. Links `docs/trust.md` (and defers entirely to it).
5. **"Why does my receipt show tokens but no dollars?"** — no cited, dated price row
   matched the model and date, and aireceipts never guesses a dollar (I2). Links
   `docs/guide/13-pricing.md` and `data/prices/`.
6. **"Why doesn't the receipt match my vendor's invoice?"** — the receipt is a local
   estimate from token counts × cited price tables, with fallbacks chosen to
   understate, never overstate. Links `docs/guide/13-pricing.md` (`--methodology`).
7. **"Why does my Cursor receipt show session totals only?"** — Cursor transcripts
   carry no per-turn usage, so per-tool attribution would be guesswork; the receipt
   says so instead of splitting by guess. Links `docs/guide/14-session-attribution.md`.
8. **"Who builds this — is it really AI agents?"** — largely yes, under a spec-driven
   harness with mutation-tested money paths and byte-golden outputs; every PR carries
   the receipt of the sessions that built it; human PRs run the same gates. Links
   `docs/internal/harness.md` and `CONTRIBUTING.md`.

FAQ header carries the split sentence: *"Seeing an error or an odd receipt? That's
[troubleshooting](guide/12-troubleshooting.md) — symptom-first. This page is
question-first."*

## Scenarios

- **Given** the current README, **When** R1–R3 land, **Then**
  `npx vitest run test/readme-guard.test.ts` passes with zero budget edits and every
  fenced receipt still byte-matches a committed golden.
- **Given** a reader who only opens the first screen, **When** they finish "Why this
  exists", **Then** the dogfood proof and its link are already on screen.
- **Given** `docs/faq.md`, **When** any relative link in it is followed from the repo
  root, **Then** the target file exists (R6 resolves them mechanically).
- **Given** the docs-site build, **When** `node scripts/build-docs-site.mjs` runs,
  **Then** `site/docs/faq.html` exists and the nav lists it.
- **Given** a future edit that pastes launch material into the FAQ, **When**
  `npx vitest run test/faq-doc.test.ts` runs, **Then** the tripwire fails the build.

## Non-goals

- **Changing the tagline** — it is byte-synced to `package.json` `description` by the
  guard; a tagline change is a separate, deliberate decision with npm-facing surface.
- **Landing-page (`site/index.html`) copy parity** — SPEC-0021 owns the landing page;
  a parity pass is a follow-up spec once the README wording settles.
- **New CLI surface** (e.g. a demo/sample-receipt flag) — product change, own spec.
- **Editing `docs/internal/launch-kit.md`** — lives on PR #96, maintainer's draft.
- **Comparative benchmarks or feature matrices vs other tools** — I6; the FAQ states
  what each tool reads and prints, nothing more.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 sentence present | README "Why this exists" | Design sentence, verbatim, linking docs/pr-receipts.md |
| R1 guard green | `test/readme-guard.test.ts` | all cases pass; no budget constant edited |
| R2 bullet order | README "What you get" | PR-receipts bullet first; same bullet count |
| R3 ccusage credit | README Related work | Design sentence verbatim; no comparative adjectives |
| R4 file + questions | `docs/faq.md` | exists; eight Design headings, verbatim |
| R4 answer length | each FAQ answer | ≤10 lines each |
| R4 canonical links | each FAQ answer | links its Design-named canonical doc |
| R5 README link | README Docs section | FAQ linked |
| R5 getting-started link | docs/guide/01-getting-started.md | FAQ linked |
| R5 cross-link | faq.md + 12-troubleshooting.md | each links the other with the split sentence |
| R5 site build | `node scripts/build-docs-site.mjs` | `site/docs/faq.html` built and in nav |
| R6 link resolution | every relative link in faq.md | resolves to a committed file |
| R6 tripwire | faq.md scanned case-insensitively | zero tripwire strings |
| R6 red path | tripwire string injected in a test copy | test fails |

## Success criteria

- [x] R1–R3 land with `readme-guard` green and zero budget-constant changes.
- [x] `docs/faq.md` ships with all eight questions, each answer grounded in a linked
      committed doc; no vendor-billing claims beyond the tool's own mechanics.
- [x] `test/faq-doc.test.ts` pins presence, links, and the tripwire, red path included.
- [x] Docs site renders `faq.html` in nav.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass unmasked
      (`echo $?`).

**Kill criterion:** if an FAQ answer cannot be written without a claim untraceable to
committed repo bytes (e.g. it needs an assertion about a vendor's billing behavior),
that entry is cut rather than softened; if R1–R3 cannot fit the guard budgets without
touching budget constants, the README portion reverts and the FAQ ships alone.

## Validation

**2026-07-05 · S1 (self):** every requirement checks from repo bytes: guard budgets
measured (README 154/260 lines, tagline sync rule at `test/readme-guard.test.ts:39-44`),
bullet and paragraph line numbers cited against current README, canonical docs for all
eight answers exist and were read (`docs/telemetry.md` tl;dr, `docs/trust.md`,
`docs/guide/13-pricing.md` methodology block, `docs/guide/12-troubleshooting.md`
symptom-first framing, `docs/internal/harness.md`), docs-site build script exists
(`scripts/build-docs-site.mjs`, SPEC-0025). The tripwire list is a drift guard and is
labeled as such, not as a completeness claim.

**2026-07-05 · approved (button 1):** maintainer, in-session ("approved"). S2
(independent critic) waived by the maintainer's solo-session directive for this
session; the S2 slot stays open for a post-hoc critic pass if the maintainer wants one.
