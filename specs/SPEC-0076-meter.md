---
id: SPEC-0076
title: "The meter — model segment in the statusline + meter-and-receipt positioning"
status: draft
milestone: M5
depends: [SPEC-0062, SPEC-0071, SPEC-0075]
---

# SPEC-0076: The meter

Invariants: I2 (never a fabricated dollar — unchanged; the new segment carries no `$`),
I3 (every value traceable — the model name is an **official payload passthrough** or the
existing dominant-model value, never inferred; each mode's semantics are documented), I5
(byte-stable — exact-string tests gate the line shape), I6 (facts, not rankings — meter
copy states what the product does, never that a model/agent is better).

## Purpose

Maintainer feedback, 2026-07-10, three items. (1) The statusline **is a meter** — the
fare ticks while the agent drives, the receipt prints when the ride ends — and that
framing exists only as one landing-page caption ("The meter while you work"); it was
never folded through the README, docs, or the line's own design. (2) The meter doesn't
say which model is running. This is a real information loss, not a nice-to-have: wiring
`aireceipts statusline` into Claude Code **replaces** the host's default status bar,
which shows the model — today adopting aireceipts hides the tariff the user previously
had. SPEC-0062 parked a `model` segment as "speculative UX with no named consumer;
propose separately with a consumer attached" — this feedback is that named consumer.
(3) The product should lead with the three features that carry the value — the meter,
the receipt, the PR receipt — and everything else belongs in the docs / "everything
else" section. **Kill criteria:** a model name that cannot be rendered from Claude
Code's own payload field or the session's dominant-model value is omitted, never
guessed; if the maintainer judges the widened default line no longer glanceable at PR
review, `model` ships opt-in (`--format`) instead of entering `DEFAULT_FORMAT`; any
meter copy that needs a claim the product can't honor (true streaming, per-token
real-time) is cut, not softened.

## Requirements

- **R1 — new `model` segment, mode-gated sources.** In **stdin-payload mode only**
  (`ctx.inputMode === "stdin_payload"`), render `payload.model.display_name` — Claude
  Code's documented statusLine payload names the **current** model
  (`model: { id, display_name }`), so a mid-session switch shows on the next render.
  When that field fails its guard (R2), or in disk-fallback mode, render
  `MiniSummary.model` — the dominant model by token share (forwarded at
  `src/receipt/mini.ts:58` from the mix computed in `src/receipt/model.ts`), the same
  value the mini receipt prints. Neither available (e.g. Cursor) → `null`, omitted
  (SPEC-0062's rule: nothing honest to say → omitted, never zero-filled). The
  `inputMode` gate matters: `runStatusline` parses the stdin payload even when the
  payload's transcript fails to load and a disk session renders instead
  (`src/cli/commands/statusline.ts:204–229`) — a stale payload's model must never sit
  beside another session's numbers. **Semantics are mode-labeled in docs (I3):** stdin
  mode shows the host's current model; fallback shows the session's dominant model.
- **R2 — one shared guard for both sources.** A single `cleanModelName` guard: trim;
  then require non-empty, ≤ 64 chars (UTF-16 units — rejecting a surrogate-heavy name
  slightly early is the safe direction), and no C0/C1/DEL control characters
  (`0x00–0x1f`, `0x7f–0x9f`) or Unicode line separators (`U+2028`/`U+2029`) — the
  statusline is a one-line contract and neither a garbled payload nor a garbage
  transcript model id may break it. Guard failure moves
  to the next source (payload → summary → omitted). Guarded payload reads follow the
  existing `quotaWindow`/`contextPct` pattern (`src/cli/statuslineSegments.ts:49,79`).
- **R3 — the default line shows the model.** `DEFAULT_FORMAT =
  "brand,model,cost,burn,tokens,context,waste,quota5h"` — identity before numbers, the
  same order the mini receipt uses (`agent · model · duration`). Renders as
  `[aireceipts] Opus · $4.20 · $9/hr · 128k · ctx 42% · 5h 24% ↺2h13m` (stdin) and
  `[aireceipts · Codex] gpt-5.2-codex · $1.10 · $4/hr · 84k` (disk fallback, priced
  with duration). `model` joins `SEGMENT_NAMES` so `--format` and `statusline.json`
  can name or drop it; memoized render and fail-fast unknown-segment behavior are
  inherited from SPEC-0062.
- **R4 — the meter framing lands on the messaging surfaces, checkably.** The metaphor:
  *the statusline is the meter running during the ride; the receipt prints when you
  step out; the receipt then rides along with the PR.* Each of these surfaces must
  contain meter phrasing after the change: `README.md` ("Why this exists" + the
  statusline feature block), `docs/statusline.md` (title/intro), 
  `docs/guide/07-statusline.md` (intro), `site/index.html` (hero/strip copy aligned
  with the same arc), and the `statusline` help line
  (`src/cli/commands/statusline.ts:258`). **Honesty bound (I3), checkable as a
  forbidden-phrase list:** none of the changed copy may contain "real-time",
  "streams"/"streaming", or "per-token live" — the meter updates when the host
  re-invokes the command and reads completed state; the staleness note in
  `docs/statusline.md` stays. Copy that names the cadence says "updates as the session
  runs" or equivalent.
- **R5 — three features lead; the rest is "everything else".** After the change, the
  README above the "Everything else it does" table contains exactly three feature
  blocks, in ride order — **while the agent works** (the meter,
  `aireceipts statusline`), **when the session ends** (the receipt,
  `npx aireceipts-cli`), **when the PR ships** (the receipt rides along,
  `aireceipts pr --post` + CI check) — plus the zero-setup entry preserved as a single
  "try it in ten seconds: `npx aireceipts-cli`" line above the arc, the install/agent
  sections, and no other feature blurbs. compare / week / handoff / templates /
  backfill / quota / exports / stats appear only in that table and the docs. The
  landing page hero mirrors the same three. This is the maintainer's feedback item 3
  verbatim, in scope by direction.
- **R6 — every example line is true.** All example statusline lines in `README.md`,
  `docs/statusline.md`, `docs/guide/07-statusline.md`, and `site/index.html` are
  updated to include the model segment exactly as R3 renders it, and the segment table
  in `docs/statusline.md` gains the `model` row (render + per-mode source + guard).
  Regenerate the docs site (`npm run docs:site`). The renderer truth is pinned by R7's
  exact-string tests; docs parity is grep-checked (this repo has no doc-testing infra —
  building one is a non-goal). GIF **alt texts** stay truthful to the recorded footage
  (GIFs are not re-recorded), so they are not edited to claim a model segment they
  don't show.
- **R7 — tests at both seams.** (a) Exact-string `renderSegments` unit tests: the new
  default on a full payload fixture; guard fallbacks (absent/non-string/empty/
  whitespace-only/65-char/control-char `display_name` → summary model); the 64-char
  boundary accepted; a padded ` Opus ` rendering trimmed; payload-over-summary
  precedence in stdin mode; disk-fallback + parseable-stale-payload rendering the
  summary model (the R1 gate); `summary.model: null` omitting the segment.
  (b) `runStatusline` integration tests (existing seams: `opts.format`,
  `opts.formatConfigPath`): `--format brand,model` renders exactly
  `[aireceipts] <model>`; a `statusline.json` with `items: ["brand","model"]` renders
  the same.

## Scenarios

- **Given** a stdin payload with `model.display_name: "Opus"` and full cost/quota data,
  **when** the default statusline renders, **then**
  `[aireceipts] Opus · $4.20 · $9/hr · 128k · ctx 42% · 5h 24% ↺2h13m`.
- **Given** a payload whose `model.display_name` is `"  "` (or 65+ chars, or contains a
  control char), and a session whose dominant model is `claude-opus-4-8`, **when** it
  renders, **then** the segment shows `claude-opus-4-8` (guarded fallback).
- **Given** a parseable stdin payload whose `transcript_path` fails to load, with a
  disk-fallback session selected, **when** it renders, **then** the model segment shows
  the fallback session's dominant model, never the stale payload's (R1 gate).
- **Given** disk-fallback mode on a priced Codex session with duration, **when** it
  renders, **then** `[aireceipts · Codex] gpt-5.2-codex · $1.10 · $4/hr · 84k`.
- **Given** a Cursor session (no per-turn model), **when** it renders, **then** no model
  segment appears — omitted, never `model unknown` on a one-line bar.
- **Given** a mid-session switch from Sonnet to Opus, **when** the next render arrives,
  **then** the segment shows Opus (the host's current model) while the session receipt
  still shows the mix — meter and receipt each labeled about what they measure.
- **Given** a reader landing on the README, **when** they read above the "Everything
  else" table, **then** they meet the ten-second try line and exactly three feature
  blocks in ride order, and none of the changed copy contains a forbidden phrase (R4).

## Non-goals

- **Renaming the command or adding a `meter` alias.** `aireceipts statusline` is wired
  into adopters' `settings.json`, tmux/starship/pwsh recipes, and SPEC-0075 docs; a
  second name is a duplicated truth. The metaphor lives in copy, not the CLI surface.
- **Meter language inside the rendered line.** The output stays factual segments; the
  brand prefix remains `[aireceipts]` (I5).
- **New telemetry fields.** SPEC-0062 R5 already sends only a boolean custom-format
  flag; the model name is payload/transcript content and never ships (I4). Explicit
  no-op — nothing to add.
- **Re-recording GIFs** (`site/assets/statusline.gif`, `quickstart.gif`) — VHS
  re-recording is its own task; alt texts stay truthful to current footage (R6).
- **Auditing the existing `context`/`quota*` segments for the stale-payload seam** —
  they predate this spec; if the same gate is wanted there, that's a separate proposal
  (scope discipline).
- **A model segment from Codex/opencode statusline payloads** — those surfaces are
  `--cwd` disk-fallback (SPEC-0075), which R1 already covers via the dominant model.
- **Doc-testing infrastructure** to machine-verify docs examples against the renderer —
  grep-level parity only (R6).
- **Any tagline replacement beyond folding the meter into "Why this exists"** — the
  billed-you/receipt headline is the brand; wholesale rebranding is out of scope.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 payload model | stdin mode, `model.display_name: "Opus"` | `Opus` segment after brand |
| R1 precedence | stdin mode, payload model + summary model both present | payload's wins |
| R1 fallback | stdin mode, no payload `model`, summary `claude-opus-4-8` | `claude-opus-4-8` |
| R1 stale-payload gate | disk_fallback + parseable payload with `display_name` | summary model, not payload's |
| R1 omitted | no payload model, `summary.model: null` (Cursor) | segment omitted |
| R2 trim | `display_name: " Opus "` | `Opus` |
| R2 empty/space | `display_name: "  "` | fallback to summary model |
| R2 non-string | `display_name: 42` | fallback |
| R2 64-char boundary | exactly 64 chars | accepted, rendered |
| R2 too long | 65 chars | fallback |
| R2 C0 control | `"Opus\nX"` | fallback |
| R2 DEL/C1 control | `"Opus\u007fX"` / `"Opus\u0085X"` | fallback |
| R2 line separator | `"Opus\u2028X"` | fallback |
| R1 gate (command level) | `runStatusline`: payload with dead `transcript_path` + `display_name: "Opus"`, disk session with a distinct dominant model | line carries the disk session's model |
| R2 fallback guarded | summary model 65 chars or control-bearing | segment omitted |
| R3 default | full payload fixture | `[aireceipts] Opus · $4.20 · …` exact string |
| R3 disk fallback | priced Codex session with duration | `[aireceipts · Codex] gpt-5.2-codex · $1.10 · $4/hr · 84k` |
| R7 format select | `runStatusline` with `--format brand,model` | `[aireceipts] Opus` exact |
| R7 config select | `statusline.json` `items: ["brand","model"]` | `[aireceipts] Opus` exact |
| R4 forbidden phrases | grep changed copy surfaces | no "real-time"/"stream"/"per-token live" |
| R4 surfaces | grep the five R4 surfaces | meter phrasing present in each |
| R5 README shape | read README above "Everything else" | quickstart line + exactly 3 feature blocks, ride order |
| R6 docs parity | grep example lines in README/docs/site | every example carries the model segment |

## Success criteria

- [ ] `model` segment renders per R1–R3 with every guard and the stale-payload gate;
      exact-string + integration tests pin the default, fallback, and omission paths.
- [ ] README leads with the ride-order three-feature arc (R5); meter phrasing present on
      all R4 surfaces; forbidden-phrase grep is clean.
- [ ] Docs/site examples all show the model segment (R6); `npm run docs:site` output
      committed; the segment table documents `model` with per-mode semantics.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, determinism check, `node scripts/spec-lint.mjs`,
      `node scripts/hygiene.mjs` all pass unmasked (`echo $?`).

## Validation

**2026-07-10 · S1 (self):** clean on I2 (segment carries no `$`), I4 (no new telemetry),
I6 (copy states facts). One honesty risk self-caught: meter copy over-claiming liveness —
bounded in R4 as a grep-able forbidden-phrase list.

**2026-07-10 · S2 (Codex, adversarial, on the draft): 14 findings.**
1. *Accepted in part (High, worth).* "No named consumer" — the maintainer's 2026-07-10
   request is the named consumer SPEC-0062's non-goal asked for; Purpose now cites that
   park-and-reversal and the stronger argument (aireceipts' statusline replaces the host
   bar that showed the model — adoption currently loses information).
2. *Accepted (High).* Premise overstated — the site already had one meter caption and the
   README already had three feature blocks; Purpose now says the deltas are copy/order +
   one segment, honestly.
3. *Accepted (High).* Kill criterion sharpened: glanceability at PR review can demote
   `model` from `DEFAULT_FORMAT` to opt-in; unavailable data omits the segment.
4. *Accepted in part (High, I3).* Mixed semantics (current model vs dominant model) are
   real; resolved by mode-labeling in docs (R1/R6) rather than dropping the passthrough —
   showing the current model is the host's own convention (its default bar does exactly
   this beside cumulative cost).
5. *Accepted (High).* Verified at `statusline.ts:204–229`: a parseable payload survives
   into disk fallback. R1 now gates the payload source on `inputMode`; scenario + matrix
   row added. Auditing the pre-existing `context`/`quota*` seam is an explicit non-goal.
6. *Accepted (High).* Guard now rejects C0+C1+DEL and applies uniformly to both sources
   (`cleanModelName`), with trim/length on the fallback too; boundary rows added.
7. *Accepted (Medium).* Disk-fallback example now includes `burn` (priced, with duration).
8. *Accepted (Medium).* Matrix rows added: trim, precedence, 64-boundary, DEL/C1, guarded
   fallback.
9. *Accepted (Medium — was High).* R4 now has objective checks: per-surface presence grep
   + forbidden-phrase grep, both in the matrix. Copy remains prose; full machine
   verification of tone is not attainable.
10. *Rejected (High).* Cutting R5 would drop the maintainer's feedback item 3 — it is the
    stated goal, not scope creep; R5 gained objective pass conditions instead. The
    no-rebranding non-goal excludes tagline replacement, not section order.
11. *Accepted in part (Medium).* R6 now states the concession: renderer truth is pinned
    by tests; docs parity is grep-level; doc-testing infra is a non-goal.
12. *Accepted (Medium).* R7 split into `renderSegments` exact-string tests and
    `runStatusline` integration tests for `--format`/`statusline.json`; matrix
    expectations made exact.
13. *Accepted (Low).* R8 cut; folded into Non-goals as the explicit telemetry no-op.
14. *Accepted (Low).* Citations fixed: `mini.ts:58` (forwarding), `receipt/model.ts`
    (dominance), `statuslineSegments.ts:49,79`, `statusline.ts:258` confirmed.

**2026-07-10 · S3 (worth):**
- **Who + how often:** every statusline user, every render — the maintainer (an everyday
  user) hit it and asked directly; multi-model sessions (`/model` switches, Opus/Sonnet
  mixes) are routine, and burn rate without the tariff is half a meter. Positioning:
  every README/landing visitor.
- **One-off vs recurring:** recurring — every render, every visitor.
- **Do-nothing:** adopting aireceipts' statusline keeps *removing* the model display the
  host bar had; the README keeps command-first framing that undersells the live meter.
  The maintainer already judged this bad (it is his feedback, verbatim).
- **Smaller fix:** for the segment there is none — it *is* a one-segment change; for
  items 1/3 the copy/order edits *are* the smallest fix, and this spec is mostly that.
- **Steelman the cut:** "the host shows the model elsewhere (`/model`), and the receipt
  shows the mix." Counter: the statusline replaces the one always-visible surface; a
  meter that hides its tariff while showing $/hr invites misattribution — the segment
  removes ambiguity rather than adding decoration.
- **Kill-criterion dry-run:** payload field is documented and `MiniSummary.model` exists
  and is already rendered by the mini receipt — survives; the glanceability demotion
  path (opt-in) remains if the maintainer wants a shorter default.

**Verdict: BUILD NOW.**

**S4 (spec-lint): pass** (`spec-lint: 74 spec(s) OK`).

**2026-07-10 · S5 (Codex, on the implementation): 3 findings, all fixed.**
1. *Accepted (Medium, I5).* `U+2028`/`U+2029` passed the guard but break a one-line bar —
   guard extended to Unicode line separators; R2 + matrix updated. The 64-char limit
   stays UTF-16 units (rejects surrogate-heavy names slightly early — the safe direction).
2. *Accepted (Medium).* The stale-payload gate was only unit-tested with a hand-fed
   `inputMode` — a command-level `runStatusline` test (dead `transcript_path` + payload
   `display_name`, disk session with a distinct model) now pins the wiring; matrix row added.
3. *Accepted (Low).* The spec's exact disk-fallback example line is now asserted
   byte-exactly.
