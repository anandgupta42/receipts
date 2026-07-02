---
name: write-spec
description: "Draft a new spec (SPEC-NNNN) for aireceipts. Use when the user asks to spec a feature, write/create a spec, or turn an idea into a milestone spec. Runs an interview gate before drafting — never drafts on a vague ask."
trigger: /write-spec
---

# /write-spec — interview, then draft

## 1. Interview gate (required — do not skip)

Before writing anything, ask the user (or reason explicitly from what they've said) to
pin down:
- **Goal** — what does this deliver, in one sentence?
- **Non-goals** — what is it explicitly not doing?
- **Kill criterion** — what would prove this was a bad idea? If none exists, that's a
  sign the idea is too vague to spec yet — say so and stop.

This is the single highest-leverage step: over-eager drafting on an underspecified ask
is the most common spec-system failure. If the ask is already precise, state your
understanding back in one paragraph and get a confirming nod before drafting.

## 2. Read first

1. `specs/TEMPLATE.md` — required structure and frontmatter.
2. `specs/SPEC-0000-product.md` — the binding invariants I1–I6. Restate the ones this
   spec touches.
3. A recent shipped spec as the voice model — terse, opinionated, concrete, no filler.
4. The real source files the design touches. Ground every claim in `file:line`. Never
   invent code that doesn't exist — if unsure, put it in Open questions (folded into
   Non-goals or a scenario, per TEMPLATE).

## 3. Numbering & frontmatter

- Next id: `ls specs/ | grep SPEC- | sort | tail -1`, then +1.
- Fill YAML frontmatter exactly: `id, title, status: draft, milestone, depends`.
- `depends` lists any SPEC ids this one builds on; `[]` if none.

## 4. Draft against TEMPLATE.md

Purpose / Requirements (`Rn`, each testable) / Scenarios (Given/When/Then) / Non-goals /
Test matrix / Success criteria (checkboxes, always include the unmasked verification
block) / Tombstone (omit — only for rejected specs).

For a milestone (`M`-file), also fill the **Agent team config** section: roles by
directory ownership, dependency waves, critical path, team prompt.

## 5. Discipline

- Status stays `draft`. This skill never sets `approved` — that's the founder's button.
  Drafts never self-approve.
- If this is research-derived, link the source.
- Keep it as tight as the reference specs — no restating AGENTS.md, no type definitions
  that belong in code (cite `file:line` / a zod schema instead).

When done: write the file, print the path, and a 2-line summary of what's still open.
