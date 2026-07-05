---
name: validate-spec
description: "Adversarially validate a draft spec BEFORE the maintainer sees it. Use after write-spec finishes, or when the user asks to validate/review a spec. A draft without a validation record cannot be approved or built."
trigger: /validate-spec
---

# /validate-spec — attack the spec before it costs anything

Code has gates L0–L8; this is the spec-side gate (S1–S4). Two motivating incidents:
- **Correctness (2026-07-02):** a spec promised "on Haiku this'd be ≈ $7.40" —
  unmeasurable, since a cheaper model might not have managed the task. Machines and
  one reviewer missed it; the maintainer caught it. → S1/S2.
- **Worth (2026-07-05):** a spec (`--pr <N>` backfill) was fully buildable and
  survived S2 — and was still an edge case not worth building. The pipeline hardened
  its *correctness* while its *worth* was self-graded ("this repo's own cleanup"),
  and the maintainer caught it at button 1. → S3.

A spec can be correct, measurable, and feasible and still not be worth building. This
gate now attacks BOTH: is it right, AND is it worth it.

## S1 — Invariant audit (self)

For every Requirement and every user-facing line the spec promises, ask:
- **Measurable?** Can this be computed deterministically from the transcript (or other
  local inputs) alone? If it needs a prediction, a judgment, or data we don't have,
  it is banned or must be reframed as labeled arithmetic / an empirical measurement.
- **I1–I6 clean?** Especially I2 (no fabricated dollars) and I6 (facts, not rankings).
- **Honest under adversarial reading?** Would a skeptical HN commenter call this line
  a lie? Rewrite until the answer is no.

## S2 — Independent critic (different model family)

Run a Codex (or non-Claude) review of the spec file with this exact framing: "Attack
this spec: (1) claims that cannot be measured or verified; (2) requirements with no
test-matrix row; (3) feasibility against the cited `file:line` seams; (4) scope beyond
the stated goal; (5) the weakest requirement — argue it should be cut; (6) **worth —
argue this should NOT be built at all: is it an edge case, over-engineering, or a
recovery for a rare workflow miss? Who concretely hits this, and how often? Is the
do-nothing outcome actually bad? Is there a smaller non-feature fix (a doc, a
one-liner, nothing)?**" Builder and critic must be different contexts; never validate
your own draft in-context. S2 does NOT bless worth — it supplies an independent worth
attack; the verdict is S3's, and the decision is the maintainer's (button 1).

## S3 — Worth-building gate (adversarial, not self-graded)

Correctness is necessary, not sufficient. Before the spec reaches the maintainer, answer
these in the Validation record — concretely, not "the repo needs it":
- **Who + how often.** Name the actual user and the real frequency of the scenario. "A
  contributor who X, ~N times per release" — not "this could be useful."
- **One-off vs recurring.** Is the motivating case a single cleanup/incident, or a need
  that recurs? A one-off motivation is a park signal, not a build signal.
- **Do-nothing.** State exactly what happens if this is never built. If that outcome is
  honest/acceptable (e.g. "the PRs stay receipt-less, which is fine"), the bar to build
  is high.
- **Smaller fix.** Is there a non-feature answer — a doc line, a tiny script, or nothing?
  If a doc closes 80% of the value, ship the doc.
- **Steelman the cut.** Write the strongest case for NOT building it. If that case is
  stronger than the build case, park the spec (Tombstone) rather than ship it to approval.
- **Kill criterion dry-run** (from the write-spec interview): what evidence already
  suggests it survives? "None yet" → name the cheapest experiment, or park.

Record a one-line **verdict: build now / defer / cut**. `defer`/`cut` → the spec is
parked with a Tombstone and does NOT go to the maintainer as a build candidate. Do not
let S2 surviving (correctness) be mistaken for S3 passing (worth) — the `--pr` backfill
spec passed S2 and failed S3.

## S4 — Mechanical lint

`node scripts/spec-lint.mjs specs/SPEC-NNNN-*.md` — frontmatter enum valid, every `Rn`
appears in the Test matrix, required sections present, no inline type definitions.

## Record & handoff

Append a `## Validation` section to the spec: date, S1 outcome, S2 findings (accepted /
rejected, one line each — including the worth attack), S3 worth answers + the one-line
**verdict (build now / defer / cut)**, S4 pass. Fixes go into the draft first.

Only a spec whose S3 verdict is **build now** goes to the maintainer as a build
candidate; approval (button 1) then means approving a spec that survived BOTH the
correctness attack and the worth attack, with the record attached. A `defer`/`cut`
verdict parks the spec with a Tombstone instead. This skill never sets `approved`.
