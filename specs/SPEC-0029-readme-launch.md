---
id: SPEC-0029
title: "Launch README — evidence-shaped first screen, receipt parity enforced"
status: building
milestone: M4
depends: []
---

# SPEC-0029 · launch README

Invariants: I1/I5 (the README's receipts are renderer output, byte-pinned to
goldens — the README can never show a receipt the product didn't produce),
I3 (every number on the page traceable to a golden), I4 (telemetry disclosure
stays prominent), I6 (no model/agent rankings anywhere on the page).

## Purpose

The repo goes public soon; the README is the launch surface. A deep-research
pass plus a hand-measured corpus of 22 Apr–Jul 2026 HN front-page launch
READMEs (Show HN ≥200 points, via the HN Algolia API; report in the
maintainer's research vault, `aireceipts-readme-launch/`) established what
actually distinguishes winners: a visual in the first 30 lines (86% — but
static, only 1/22 animated), one crisp human tagline (plain register — only
14% lead with a number), near-zero emoji (median 0.5), list- and code-heavy
moderate length (~240 lines, ~20 list items, ~10 code blocks, ~10 links),
light badges (median 1), install early (64% in the first 60 lines).
Peer-reviewed studies (JSS 2023 n=5,000; SP&E 2025 n≈2,000) add: lists,
links, images, and README update frequency discriminate popular repos;
install-instruction polish does not (table stakes). The current README
(104 lines) already leads with a tagline + real text receipt; this spec
upgrades it to the full evidence shape and — the part that outlives launch
day — **mechanically enforces that the README never drifts from the
product**.

**Kill criterion:** (a) if the inline or hero receipt cannot be kept
byte-identical to a committed golden (the guard test fails on every
receipt-output change until the README is regenerated), that is the feature
working — but if in practice the guard makes routine receipt changes
unshippable (more than one forced README regeneration per week of normal
development), the pinning narrows to the hero only; (b) the structural
budgets (R4) serve the prose, not the reverse — if the maintainer judges at
review that a budget forces awkward writing, the budget loosens and the
guard constant changes in the same PR, never the prose bending to the
number.

## Requirements

- **R1 — First screen (title → tagline → badges → hero).** The tagline is
  one bold sentence in plain human register, <120 characters — the README's
  first bold paragraph (the guard anchors on the first `**…**` line, never a
  line number) — and **byte-identical** in three places: that line,
  `package.json` `description`, and the GitHub repo description (release-day
  step, exact command: `gh repo edit --description "<tagline>"`; topics
  `gh repo edit --add-topic ai-agent --add-topic claude-code --add-topic
  codex --add-topic cli --add-topic developer-tools` ride the same
  checklist — maintainer's button, never CI). The badge row sits
  directly under the tagline: at most 3 badges (CI, npm version, license),
  newline-delimited, no heading. The tagline is "Your AI coding
  agent just billed you. Here's the receipt." — swapped at build time from
  the 33-minute variant because the hero receipt's REAL duration (10m 30s)
  must never sit next to a contradicting number (parity spirit; recorded
  here per R1's own rule); the Design section is the
  place to swap it, nowhere else. The tagline must be bold and under 120
  characters (guard-tested).
- **R2 — Hero: the real receipt as an image, then as bytes.** A
  `<picture>` element with `prefers-color-scheme` sources pointing at the
  **committed golden SVGs** (`goldens/svg/…-light.svg` / `…-dark.svg` — the
  existing exporter's output, not hand-made art), followed by the smallest
  real text receipt in a code block as the copy-paste "expected output."
  The text receipt is the byte content of a committed `goldens/*.txt` file,
  fence-wrapped. Both references are to files that already exist and are
  already golden-gated; the README adds zero new artifacts to maintain.
- **R3 — Structure (Standard-Readme order, corpus budgets).** Sections in
  order: hero → Install (`npx aireceipts`, one block — table stakes, no
  polish beyond correctness) → Usage (CLI table covering `aireceipts`,
  `pr [--post] [--artifact] [--no-details]`, `week`, `compare`, `--svg/--png`,
  `--json`, `install-hook`; each row links its doc — guard checks every named command appears with a link) → What you get (list
  form) → The honesty rules (kept — it is the brand; links `docs/trust.md`
  in the first line) → Supported agents → Telemetry, disclosed (kept,
  I4) → Docs links block → Contributing (short: spec-driven flow, link
  `CONTRIBUTING.md`) → License. Existing content is reshaped, not rewritten
  from scratch; the honesty-rules and telemetry sections keep their current
  substance.
- **R4 — The README guard (new test, `test/readme-guard.test.ts`).**
  Asserts mechanically: (a) tagline line equals `package.json` description
  byte-for-byte; (b) every fenced receipt in README is byte-identical to a
  committed golden file modulo the single trailing newline every golden
  ends with (fence content carries none — the only permitted difference);
  (c) the `<picture>` sources resolve to files that exist in `goldens/svg/`;
  (d) emoji count ≤ 2 (the 🥟 signature plus the title 🧾 only); (e) total
  length ≤ 260 lines; (f) `docs/trust.md` and `docs/telemetry.md` linked
  (the existing trust-doc test's README assertion stays where it is —
  redundancy over coupling); (g) the tagline is bold and <120 chars.
  List/link density (corpus: ~20 lists, ~10 links) is Design guidance
  enforced at review, NOT a numeric gate — floors invite gaming and worse
  prose. Budget constants carry a one-line citation to the committed
  research note (below).
- **R5 — The evidence ships with the repo.** A short research note
  (`docs/internal/readme-evidence.md`, ~40 lines) commits the corpus table
  (22 HN launches, aggregates, method, limitations) and the study citations
  the guard constants reference — so the README's shape is explainable from
  inside the repo, not from a private vault. The full report stays in the
  maintainer's vault; the note links nothing external except the sources.

## Design (lead-authored — implementers execute, never invent)

First screen, exactly:

```
# aireceipts 🧾

**Your AI coding agent just billed you. Here's the receipt.**

[CI badge] [npm badge] [license badge]

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="goldens/svg/claude-code-clean-multi-tool-2-models-dark.svg">
  <img alt="a rendered aireceipts receipt" src="goldens/svg/claude-code-clean-multi-tool-2-models-light.svg" width="520">
</picture>

<smallest real receipt from goldens/*.txt, fenced>

Install:                       ← reached inside 60 lines
    npx aireceipts
```

Copy rules: no emoji besides the title 🧾 and the footer 🥟 already inside
the receipt bytes; no marketing adjectives ("blazing", "powerful") anywhere (review-enforced copy rule, not guard-testable);
every claim about behavior links the doc that proves it (`docs/trust.md`
carries the skeptic load); section prose stays terse — the corpus median is
240 lines and this page targets ~180–260. The CLI table's `pr` row says
"attach the receipt to your PR" and links `docs/pr-receipts.md`; the trust
link line reads: "What a receipt proves — and what it can't:
[docs/trust.md](docs/trust.md)."

## Scenarios

- **Given** any future change to receipt output that regenerates goldens,
  **when** CI runs, **then** the README guard fails until the README's
  fenced receipt is updated to the new golden bytes — the README cannot
  silently show stale output.
- **Given** a contributor edits the tagline in README only, **then** the
  guard fails on the package.json mismatch until both (and, at release, the
  GitHub description) move together.
- **Given** the README gains a fourth badge or a third emoji, **then** the
  guard fails.
- **Given** a reader on a dark-mode GitHub page, **then** the hero renders
  the dark-theme golden SVG.

## Non-goals

- **The launch post / Show HN copy** (separate artifact; the research's
  tagline-variant testing belongs there).
- **Animated terminal recordings.** 1/22 corpus winners used one; static
  golden SVGs win and cost nothing. Revisit only on evidence.
- **README-driven marketing sections** (comparisons, star history, "why not
  X" tables) — I6 adjacent; facts and links only.
- **Automating the GitHub description/topics sync** (R5 is a recorded
  manual step — repo settings are the maintainer's button).
- **Rewriting docs/** — this spec touches `README.md`, the guard test, the
  evidence note, and `package.json`'s description.
- **npm README rendering.** The hero and relative links resolve on GitHub
  (the launch surface); `files:` excludes `goldens/` and `docs/`, so the npm
  page will render degraded until publish day. Recorded release-checklist
  decision (maintainer): either add the two hero SVGs to `files:` or
  absolutize the URLs at publish — not decided here.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 tagline sync | README line 3 vs package.json description | byte-identical (guard) |
| R1 badges | badge row | ≤3, under tagline, no heading |
| R2 hero sources | `<picture>` srcset/src paths | both exist under goldens/svg/ |
| R2 receipt parity | every fenced receipt in README | byte-equal to a committed goldens/*.txt |
| R3 order | section headings | Standard-Readme order as specified |
| R3 install early | Install heading | within first 60 lines |
| R4 emoji budget | README bytes | ≤2 emoji |
| R4 length cap | README bytes | ≤260 lines |
| R1 tagline shape | first bold paragraph | bold, <120 chars |
| R4 doc links | README | docs/trust.md + docs/telemetry.md present |
| R4 guard red | mutate a fenced receipt byte in a test copy | guard fails |
| R3 CLI table coverage | table rows | every named command present with a doc link |
| R5 evidence note | docs/internal/readme-evidence.md | exists; corpus table + citations present |

## Success criteria

- [ ] README renders correctly on GitHub (checked on the PR's rich-diff
      view) in light and dark mode, hero visible in the first screenful.
- [ ] `test/readme-guard.test.ts` passes, and demonstrably fails when a
      fenced receipt byte is mutated (red-then-green shown in the PR).
- [ ] `/review-docs` run on the new README (advisory now, blocking at
      release).
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, `node scripts/spec-lint.mjs` all
      pass unmasked (`echo $?`); goldens untouched (the README references
      goldens, it never regenerates them).

## Validation

**2026-07-03 · S1 (self):** every requirement is mechanically checkable from
repo bytes (guard test) except the copy rules, which are explicitly marked
review-enforced. The one novel mechanism — README-to-golden receipt parity —
is the spec's point: the launch page can never show output the renderer
didn't produce (I5 extended to marketing surface). Verified before drafting:
light AND dark golden SVGs of the named fixture exist
(`claude-code-clean-multi-tool-2-models-{light,dark}.svg`).

**2026-07-03 · S2 (Codex, read-only): REWORK → draft reworked.** Findings 1–2
were lost to output truncation (capture window); their most likely subjects —
dark-SVG existence and the brittle "README line 3" anchor — were both
addressed regardless (fixture verified above; anchor is now the first bold
paragraph, never a line number). Visible findings and disposition:
3. `hook install` is not a shipped command (`install-hook` is) — **accepted**;
   R3 corrected.
4. Missing matrix rows (tagline shape, badge layout, CLI-table coverage) —
   **accepted** for the testable ones (rows added); "no marketing
   adjectives" and "smallest receipt" explicitly demoted to review-enforced
   design/copy rules — a guard cannot judge prose.
5. Research claims used with requirement force but living outside the repo —
   **accepted**; new R5 commits `docs/internal/readme-evidence.md` (corpus
   table + citations) so the shape is explainable from inside the repo.
6. GitHub `<picture>`/relative-SVG rendering confirmed against GitHub Docs;
   dark-mode selection is a manual rich-diff check — **accepted**; success
   criterion already requires it.
7. R5 (repo description/topics sync) called scope creep — **accepted**;
   demoted from a requirement to a recorded release-day command inside R1,
   maintainer's button, never CI.
8. Cut the list/link floors as correlation cargo-culting — **accepted**;
   density is design guidance at review, not a numeric gate. Caps (emoji,
   length) and parity remain gates.

**2026-07-03 · S3 (value gate):** the kill criterion's evidence exists in
this session's own history: receipt output changed three times today
(round 1, round 2, floors) — under this spec each change would have forced a
visible README refresh, which is exactly the update-cadence behavior the
popularity studies reward. If that cadence proves too costly (>1 forced
regeneration/week), the criterion narrows pinning to the hero.

**2026-07-03 · S4 (lint):** `node scripts/spec-lint.mjs` → 29 spec(s) OK,
exit 0.

**2026-07-03 · approved (button 1):** maintainer, in-session ("approved"). Status → building.

**2026-07-03 · S5 (implementation review, Codex): REWORK → fixed.** Findings
1–3 lost to capture truncation (twice now — process note: pipe reviews to a
file). Visible findings: (4) CLI-table guard asserted a loose link count —
accepted, now per-command linked-row checks; (5) trailing-newline
normalization contradicted "byte-for-byte" — accepted, spec wording made
precise (the single trailing golden newline is the only permitted
difference); (6) the Design block still carried the old 33-minute tagline —
accepted, fixed; (7) npm README will render degraded (files: excludes
goldens/docs) — accepted as a recorded publish-day decision in Non-goals,
not solved here. Red-then-green for receipt parity demonstrated live
(mutated dollar → guard names the exact failure → restored green).
