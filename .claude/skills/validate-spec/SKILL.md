---
name: validate-spec
description: "Adversarially validate a draft spec BEFORE the founder sees it. Use after write-spec finishes, or when the user asks to validate/review a spec. A draft without a validation record cannot be approved or built."
trigger: /validate-spec
---

# /validate-spec — attack the spec before it costs anything

Code has gates L0–L8; this is the spec-side gate (S1–S4). Motivating incident
(2026-07-02): a spec promised "on Haiku this'd be ≈ $7.40" — unmeasurable, since a
cheaper model might not have managed the task. Machines and one reviewer missed it;
the founder caught it. This skill exists so the pipeline catches the next one.

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
the stated goal; (5) the weakest requirement — argue it should be cut." Builder and
critic must be different contexts; never validate your own draft in-context.

## S3 — Value gate

The spec's kill criterion (from the write-spec interview) gets a dry run: what evidence
already suggests this survives it? If the honest answer is "none yet", the spec must
name the cheapest experiment that would produce that evidence — or be parked.

## S4 — Mechanical lint

`node scripts/spec-lint.mjs specs/SPEC-NNNN-*.md` — frontmatter enum valid, every `Rn`
appears in the Test matrix, required sections present, no inline type definitions.

## Record & handoff

Append a `## Validation` section to the spec: date, S1 outcome, S2 findings (accepted /
rejected, one line each), S3 evidence, S4 pass. Fixes go into the draft first. Only then
does the spec go to the founder — approval (button 1) means approving a spec that has
already survived attack, with the record attached. This skill never sets `approved`.
