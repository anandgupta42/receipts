---
id: SPEC-0077
title: Shareable receipt cards — `--card` output flag (session + PR)
status: draft
milestone: M5
depends: [SPEC-0003, SPEC-0012, SPEC-0023, SPEC-0026, SPEC-0027, SPEC-0035, SPEC-0043, SPEC-0059]
---

# SPEC-0077: Shareable receipt cards — `--card` output flag (session + PR)

Invariants: I1 (deterministic, zero model calls, **zero network** — the card is a local
image plus a clipboard write plus *printed* web-intent URLs; nothing is uploaded, fetched, or
hosted, and no browser is launched), I2 (`$` only from dated price rows; unpriced atoms carry
tokens and the `≥` floor marker, never a fabricated dollar), I3 (card + caption are extracted
numbers and fixed templates; the cheaper-model line is labeled arithmetic, no counterfactual),
I4 (local-first; the share step is an explicit per-invocation action over the user's own
clipboard — disclosed and escapable), I5 (the card SVG is a new byte-stable output surface —
goldens gate every layout/theme), I6 (facts, not rankings).

Design source: maintainer-reviewed mockup at
`claude.ai/code/artifact/ef431aa5-ea29-4206-a6ae-36bfbda4c03d` (`receipt-cards-v2`,
2026-07-10). A static copy is committed at
`docs/spikes/spec-0077-receipt-cards-design.html`. The mockup's **recap** layout is **deferred
to SPEC-0078**; this spec builds the **session** and **PR** unit cards, both matching the
mockup's unit layout (total · model mix · tool line-items · cache · cheaper-model line).
**The implementer executes this design; it does not invent layout, copy, or palette.**

## Purpose

aireceipts has no surface built to *leave* the terminal and the PR and travel on social media.
`--card` adds one: it re-renders a receipt as a 1200×630 social card (the OG/Twitter ratio)
and runs a one-gesture, fully-local share step — image on disk, image on the clipboard, caption
and web-intent URLs printed. v1 covers the two scopes whose data models exist today: a single
**session** (default command) and a **PR** (`aireceipts pr`, multi-session attribution,
SPEC-0023). The PR card carries the same rich breakdown as the session card by aggregating the
per-contributor `ReceiptModel`s the PR flow already builds (§R2). It serves I4's "a shared
receipt is the one thing worth sharing, and sharing is always your call": the card is the
shareable unit; aireceipts hosts, uploads, and fetches nothing.

**Kill criterion:** two maintainer-dogfood releases plus user feedback with no evidence anyone
generated a card to share it (R8 near-zero, no cards referenced in issues / social / dogfood
notes) → the flag is removed. A card that leaks any R4 "never" field on a real session is an
immediate fix or the flag ships disabled until fixed.

## Requirements

- **R1 — `--card` is an output flag with a new renderer.** Add `--card` to the shared option
  parser (`src/cli/options.ts`), wired into the **receipt** command path
  (`src/cli/commands/receipt.ts`, via `src/cli/common/output.ts`) and the **`aireceipts pr`**
  path (`src/pr/index.ts`). Not added to `week` (recap deferred). The card is a **new SVG
  renderer** — `renderReceiptSvg` (`src/receipt/svg.ts:408`) is a single-`ReceiptModel`,
  640-wide *tall* receipt and is **not** reused for layout; the card renderer (`renderCardSvg`,
  new in `src/receipt/card.ts`) is a fixed **1200×630** landscape layout that **reuses**
  `THEMES` (`src/receipt/svg.ts:34`) and the dot-leader/glyph primitives. Output-format rules:
  - `--card` → write a **PNG** raster (`rasterizeSvgToPng`, `src/receipt/png.ts:23`) to the
    default card path; `--card --png` is the same (explicit default).
  - `--card --svg` → write the card **SVG** (the deterministic, goldened artifact).
  - `-o <file>` → that single path; `--card` never writes two files; `--card --svg --png` is a
    usage error.
  - `--card` with `--json`/`--csv` is a usage error (not silent precedence).

- **R2 — Card view-model + two builders (the PR aggregate contract).** `renderCardSvg` consumes
  one `CardModel` — `{ scope, scopeLabel, totalUsd, floored, tokens, modelMix[], toolRows[],
  cacheServedPct, cheaperModel?, sessionCount, subagentCount, roles[] }`. **`scopeLabel` is a
  fixed non-title string — the agent + date for a session, `PR #<n>` for a PR — and is never
  the prompt-derived session title (R4).** Built two ways:
  - **Session scope:** projected directly from the per-session `ReceiptModel`
    (`src/receipt/model.ts:85`): `modelMix`, `toolRows`, `totalTokens` are already present; the
    cache % is `cacheServedPct` (`src/receipt/present.ts:62`) over `totalTokens` (**not**
    `cacheReadAtInputRateUsd`, which is a dollar field). The cheaper-model line reuses the
    SPEC-0059 arithmetic unchanged.
  - **PR scope — `buildPrCardModel(...)` (new, `src/pr/cardModel.ts`).** The atom universe is
    the existing `collectAtoms` set (`src/pr/body.ts:181`, **today private — lift/export it and
    `totalsFor` for reuse**): every top-level contributor plus its subagents.
    `buildPrCardModel` is invoked from `src/pr/index.ts` over the retained `entries`. Field
    derivation, all from data the PR flow **already builds** (§Validation S3):
    - **totalUsd + floor:** `pricedSubtotal` from `totalsFor` (`src/pr/body.ts:203`); the `≥`
      floor marker (`src/pr/body.ts:295`) when
      `excludedCount||unreadableCount||tokensOnlyCount||isFloored`. Because the card shows **one
      headline number**, any readable-but-unpriced atom also forces the `≥` floor (stricter than
      the comment's split `TOTAL priced`/`TOTAL unpriced`). **No fabricated "x of n" ratio** —
      coverage is the `≥` marker plus the counts line, the repo's existing convention.
    - **modelMix %:** token-weighted sum of every atom's `modelMix` across the PR (new
      aggregation; the per-atom mixes exist, `src/receipt/model.ts:179`).
    - **toolRows:** sum `usd`/`tokens`/`callCount` by tool name across atoms (new aggregation
      over the retained models).
    - **cacheServedPct:** `cacheServedPct` (`src/receipt/present.ts:62`) over the summed
      `TokenUsage` — the same aggregate the comment already renders (`src/pr/body.ts:309`).
    - **cheaperModel:** **omitted on the PR card in v1.** The SPEC-0059 arithmetic
      (`priceDeltaFootnote`) reprices a *single* model's tokens against a vendor's cheapest
      current row; the aggregated `modelMix`/`toolRows` do not retain per-atom price-row/vendor
      provenance (readable subagents keep only a model string + usd/tokens), so an aggregate
      repricing cannot be made I2/I3-safe without new capture. It renders on the **session card
      only**; a provenance-carrying aggregate is a candidate for a later spec.
    - **counts/roles:** `sessionCount = contributors.length`, `subagentCount` (`childCount`,
      `src/pr/body.ts:181`), roles from `deriveRole` (`src/pr/contributors.ts:322`).

- **R2a — Retain readable-subagent detail.** For readable subagents, `rollupChildren` already
  calls `buildReceiptModel(session)` (`src/pr/rollup.ts:83`) and then discards everything but
  `usd`/`tokens` (`src/pr/rollup.ts:87`). Widen `SubagentRow` (`src/pr/rollup.ts:13`) to retain
  `modelMix` and `toolRows` so subagents contribute to the R2 rollup. **Unreadable** children
  are never parsed (`src/pr/rollup.ts:76`) and stay counted-only — they push the total to the
  `≥` floor and are excluded from the mix/tool breakdown (I2/I3). This is additive to
  `SubagentRow`; the comment/fence rendering is unchanged (it reads only `count/usd/tokens`).

- **R3 — One card renderer, both themes.** `renderCardSvg(cardModel, { theme })` emits the
  design's unit layout — total · session/agent meta · model-mix bar · tool line-items with
  dotted leaders · cache line · cheaper-model line (where R2 provides one) — at a fixed
  1200×630 viewbox, in light and dark, reusing `THEMES` and the receipt idiom (monospace,
  dot-leaders, dashed rules, square corners). The **card SVG is goldened** for
  session×{light,dark} and PR×{light,dark}; the PNG path is tested for dimensions + successful
  decode only (the PNG contract disclaims cross-platform byte-determinism, `src/receipt/png.ts`).
  **`rasterizeSvgToPng` currently hard-codes the receipt width (`PNG_WIDTH`, `src/receipt/png.ts:20`);
  the card requires extending it to accept explicit 1200×630 dimensions (or a sibling
  rasterizer) — an API change, not a call-site tweak.**

- **R4 — Sanitized always; single artifact.** There is exactly one card image, always
  sanitized. It carries ONLY: cost, tokens, cache-hit rate, model mix, tool breakdown,
  session/agent counts, dates, and the cheaper-model line. It **never** carries:
  prompts/replies/transcript, source or file contents, **session titles**, **repo / branch /
  project names**, or file paths. Because there is one shared image, `--include-titles` /
  `--include-projects` / `--by-project` are a **usage error with `--card`** (clear message: the
  card is always sanitized). This is the `--no-details` contract, hard-enforced.

- **R5 — Layered PR link: opt-in, local-only, linkless by default.** A single image cannot
  carry the full PR receipt (multi-session, per-commit, expandable detail); the card is the
  *hook* and the full receipt lives on a surface the user owns. The full-receipt URL contains
  `owner/repo/pull` (an R4 "never" field), so:
  - **Default: no link, no URL** in caption or image. The caption may name `PR #<n>` (the
    number alone, no owner/repo).
  - `--link` opts in and places the URL **in the editable caption only** — **never in the
    image** (R4 is absolute; there is no image-stamp option in v1).
  - The URL is only ever a value aireceipts **already holds locally** — the sticky-comment
    permalink from the result of a `--post` in the *same* invocation, or a published SPEC-0027
    artifact URL from the same `--artifact` run. **`upsertPrComment` (`src/pr/comment.ts`) must
    surface the created/updated comment's `html_url` — the GitHub create/update API returns it
    but the code does not expose it today; when it cannot be captured (e.g. first-create edge
    cases), `--card --link` falls back to linkless.** **Never fetched** (I1), so `--link`
    **requires `--post`**; dry-run `pr --card` is always linkless. The *only* network the card
    flow performs is the user's explicit `--post` (already a network action); `--card` without
    `--post` is fully offline.
  - Repos of **private or unknown visibility**: `--link` is refused (the SPEC-0035 public
    viewer 404s for private; a private permalink resolves only for teammates). Reuses the
    existing visibility check — `repoVisibility` in `src/pr/comment.ts`, called from
    `src/pr/index.ts` via `gh api`; that call rides the already-networked `--post` flow, so
    **card render itself never touches the network** (I1).

- **R6 — The share step: one gesture, nothing hosted, no browser.** When `--card` runs, after
  writing the image, aireceipts: (a) copies the **image** to the OS clipboard best-effort
  (`osascript` on macOS, `wl-copy`/`xclip` on Linux, PowerShell on Windows) — **one clipboard
  payload**; the caption is *printed to stdout*, never contending for the clipboard; (b) prints
  X and LinkedIn **web-intent** URLs with the caption (and, only under `--link`, the R5 URL)
  prefilled, built under SPEC-0035's rules — first-party only, **no third-party resource, no
  tracking parameter**; (c) prints the honest note `drag the image in — composers can't attach
  it for you`; (d) discloses in one line when a platform's clipboard copy is unavailable (image
  still on disk). The only subprocess the card path spawns is that local clipboard tool. The
  guarantee is **no browser launch, no network socket, no upload, no OAuth, no `--open`**
  (I1/I4) — not "no subprocess." URLs are printed, full stop.

- **R7 — Caption: fixed templates, no model calls.** Session: `$<total> · <agent> · <n> tools`.
  PR: `PR #<n> — $<total> across <n> sessions` (+ ` · full receipt ↓` and the URL only under
  `--link`). Token fallback replaces `$<total>` when unpriced (I2). No repo, branch, project, or
  title ever appears (I3/R4). The SPEC-0059 banned-phrase guard extends to caption strings;
  transcript-derived tool/model strings are treated as untrusted and escaped.

- **R8 — Adoption telemetry (content-free).** Emit one allowlisted `card_generated` event:
  `scope` (`session|pr`), `theme` (`light|dark`), `format` (`png|svg`), `linkIncluded` (bool),
  `clipboardImageCopied` (bool). No repo, title, project, dollar, or token value. Added to the
  strict allowlist (`src/telemetry/schemas.ts`); honors existing kill switches (SPEC-0043).

- **R9 — Docs parity.** A `docs/guide/` page documents `--card`, the layout, the local share
  step, the opt-in PR link, and the R4 privacy defaults; the README gains a short mention.
  Shipped in the same PR.

## Scenarios

- **Given** a session costing $0.18 on one model, **when** `aireceipts --card` runs, **then** a
  1200×630 PNG (unit layout) is written and copied to the clipboard, the caption prints with no
  repo/title, the cheaper-model line renders, and intent URLs print with no tracking params.
- **Given** a PR of 3 contributors (1 orchestrator + 2 helpers) with 2 readable subagents,
  totalling $3.13, **when** `aireceipts pr 189 --card` (dry-run) runs, **then** the card shows a
  PR-aggregated model mix, summed per-tool line-items (contributors **and** readable subagents),
  aggregate cache %, `3 sessions`, and **no** repo/branch and **no** link (dry-run linkless).
- **Given** that PR has one **unreadable** child, **then** the card total carries the `≥` floor
  marker, the unreadable child is excluded from the mix/tool breakdown, and the cheaper-model
  line is omitted (floored).
- **Given** `aireceipts pr 189 --post --card --link` on a **public** repo, **when** the post
  succeeds, **then** the caption includes the sticky-comment permalink from the post result
  (never fetched) and the image contains no URL.
- **Given** the same on a **private/unknown** repo, **then** `--link` is refused and the card is
  shared linkless.
- **Given** `--card --include-titles` (or `--by-project`), **then** a usage error: the card is
  always sanitized.
- **Given** a Linux host without `wl-copy`/`xclip`, **then** the image is written and a one-line
  note says clipboard copy was unavailable.
- **Given** any card render, **when** goldens are verified, **then** the session and PR SVGs
  (light+dark) are byte-identical to the committed goldens; the PNG is asserted for dimensions +
  decode only.

## Non-goals

- **Recap / window scope (week, month, `--since`) → SPEC-0078.** Its aggregate (model mix, tool
  mix, cache, PR count, active days, fun equivalence over an arbitrary range) does not exist on
  `WeekDigest` today and needs its own provenance/privacy contract. This spec ships the scopes
  whose data exists; the mockup's recap layout is SPEC-0078's design target. **No `--since`
  duration syntax** is introduced here.
- **No hosted URL / OG-image service** (I1/I4; SPEC-0052 defers any server).
- **No `--open`/browser launch, no auto-post, no OAuth, no image-stamp of the link.**
- **No native Slack / Linear output** in v1.
- **The PR card omits the cheaper-model line** — an aggregate repricing lacks per-atom
  price-row/vendor provenance to stay I2/I3-safe (R2); it renders on the session card only.
- **No efficiency grade or model ranking** (I6); the cheaper-model line stays labeled
  arithmetic (I3).
- **Repo / branch / project names and titles never enter a card or caption** — enforced as a
  usage error, not a toggle.
- **No card JSON/CSV** (those surfaces exist); **no cross-platform PNG byte goldens** (contract
  disallows it).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 combos | `--card`, `--card --svg`, `--card -o f`, `--card --svg --png`, `--card --json` | PNG / SVG / single file / usage error / usage error |
| R1 wiring | session `--card`; `pr --card`; `week --card` | card path in first two; `week --card` rejected |
| R2 PR model-mix rollup | 3 contributors, distinct model mixes | token-weighted PR mix (golden) |
| R2 PR tool rollup | contributors + 2 readable subagents | per-tool sums include subagents (golden) |
| R2 cheaper-model scoping | session card; PR card | line present on session, **absent on PR** |
| R2 floored PR | PR with 1 unreadable child | `≥` total; unreadable excluded from mix/tools |
| R2 card floor on unpriced | PR w/ 1 readable-unpriced atom | headline shows `≥` (stricter than comment split) |
| R3 PNG dims | card render | rasterizer emits 1200×630 (API extended) |
| R5 permalink on create | first `--post --card --link` | `html_url` surfaced, else linkless fallback |
| R2a SubagentRow widening | readable child fixture | `modelMix`/`toolRows` retained; comment/fence bytes unchanged |
| R3 SVG golden | session + PR fixtures | card SVG light+dark byte-identical to goldens |
| R3 PNG | any fixture | 1200×630 dims, decodes; bytes NOT goldened |
| R4 privacy default | fixture w/ titles/repo/branch/project | none appear in image or caption |
| R4 opt-in refusal | `--card --include-titles`, `--by-project` | usage error |
| R5 dry-run linkless | `pr --card` | no URL anywhere |
| R5 post+link public | `pr --post --card --link` public | permalink in caption from post result; image URL-free |
| R5 private refusal | `pr --card --link` private/unknown | link refused, linkless card |
| R6 clipboard fallback | host without clipboard tool | image written; unavailable note |
| R6 no launch | any `--card` | assert no browser spawn and no network socket; local clipboard subprocess allowed |
| R6 intent hygiene | any `--card` | intent URLs: no UTM/tracking, no third-party host |
| R7 caption template | session + PR | fixed strings; token fallback unpriced; banned-phrase guard passes; hostile tool/model strings escaped |
| R7 URL encoding | `--link` caption | URL percent-encoded correctly |
| R8 telemetry | `--card` dry-run | content-free `card_generated` allowlisted; kill switch honored |
| R9 docs parity | guide + README | `--card` documented; field-parity checks pass |

## Success criteria

- [ ] `renderCardSvg` renders session and PR unit cards (light+dark) per the design; SVG goldens
      committed and reviewed; PNG asserted for dims/decode.
- [ ] `buildPrCardModel` aggregates model-mix, per-tool cost, and cache across contributors +
      readable subagents; `≥` floor + cheaper-model-omit-when-floored honored; `SubagentRow`
      widening leaves comment/fence bytes unchanged (pinned by test).
- [ ] Share step writes image + copies image to clipboard + prints caption and hygienic intent
      URLs with **no network socket and no browser launch** (asserted); only subprocess is the
      clipboard tool.
- [ ] R4 privacy defaults enforced; sanitization opt-ins refused with `--card`.
- [ ] R5 PR link opt-in, local-only, dry-run linkless, private refused.
- [ ] R8 telemetry allowlisted + content-free; R9 docs shipped same PR.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?` = 0 each).

## Validation

**Date:** 2026-07-10 · builder: Claude (Fable), critic: Codex (codex-cli, read-only,
independent context), 2 review passes + a PR-data-model audit.

**S1 (self):** the full-receipt URL contains `owner/repo/pull` (R4 "never") → R5 keeps the link
opt-in, local-only, out of the image. Web intents cannot attach an image → R6 states the
one-drag limit. The cheaper-model line reuses the shipped labeled-arithmetic idiom (I3).

**S2 (Codex, two passes — dispositions):** *Pass 1 (12 findings):* accepted & fixed — default
PR link/repo leak (R5 opt-in, linkless default, private refused); one-image vs sanitization
opt-ins (R4 usage error); `--open`/fetch breaks I1 (removed; R5 never fetches); seam map
corrected to `svg.ts`/`png.ts`/`cli/common/output.ts`; flag combinations (R1); clipboard
one-payload + SVG-golden/PNG-dims (R3/R6); privacy tests widened. Deferred — recap/window →
SPEC-0078. *Pass 2:* fixed — image-stamp `--stamp` dropped (R4 absolute); "no process launch"
corrected to "no browser + no network socket" (the clipboard subprocess is expected, R6);
visibility guard seam corrected to `repoVisibility` in `src/pr/comment.ts` riding the
`--post` network (R5). The two Pass-2 majors — **the PR aggregate does not exist** and
**coverage has no `x of n`** — are resolved by this revision's R2/R2a: a defined
`buildPrCardModel` that sums the models the PR flow already builds and retains readable-subagent
detail (`rollup.ts:83` already computes it), with coverage expressed by the existing `≥` floor
marker, not a fabricated ratio. *Pass 3 (aggregate audit):* fixed — the aggregate cheaper-model
line is **not** I2/I3-safe (no per-atom price-row provenance) → dropped from the PR card, session
only; `CardModel.title` was a title-leak → renamed to a fixed `scopeLabel`; `rasterizeSvgToPng`
hard-codes width → card needs an explicit-dimension API; `upsertPrComment` returns no URL → must
surface `html_url` or fall back linkless; readable-unpriced atoms must floor the card headline;
`collectAtoms`/`totalsFor` are private → lift for reuse; session cache source is
`cacheServedPct` over `totalTokens`, not the USD field. Remaining items are exact-seam
confirmations for the builder, not design gaps.

**S3 (worth):** *Who + how often:* the maintainer and any user posting what a session or PR cost
— recurring, opt-in. *Do-nothing:* receipts stay inside the terminal/PR; no low-friction path to
social, the market's identified distribution wedge. *Smaller fix:* `--svg`/`--png` exist for the
session but are the wrong ratio, have no share step, no sanitization guarantee, and are absent
on `pr`. *Steelman the cut:* the PR aggregate is net-new code (mix + tool summation, subagent
widening) — but every input already exists and readable-subagent detail is built then discarded
today, so the cost is aggregation + a renderer, not new capture. **Verdict: build v1 (session +
PR full aggregate); recap → SPEC-0078.** Codex re-review required before commit (push gate).

**S4 (id):** SPEC-0077 verified free 2026-07-10 against `origin/main` (tops at SPEC-0075) and
open PRs (#233 = `spec/0076-meter`, #144 = SPEC-0057). Re-verify before commit — concurrent
maintainer sessions can claim 0077 first.
