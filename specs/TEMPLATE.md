---
id: SPEC-NNNN
title: <short imperative title>
status: draft # draft | approved | building | shipped | rejected | superseded
milestone: M<n>
depends: [] # list of SPEC-NNNN ids this depends on, or []
---

# SPEC-NNNN: <title>

## Purpose

One paragraph: what this spec delivers and why. Link to the SPEC-0000 invariant(s) it
serves.

## Requirements

Numbered, testable requirements.

- **R1** — ...
- **R2** — ...

## Scenarios

Given/When/Then, one per requirement or behavior that needs it.

- **Given** ... **When** ... **Then** ...

## Non-goals

What this spec explicitly does NOT do (deferred, or permanently out of scope). State the
reason for each.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| ... | ... | ... |

## Success criteria

- [ ] ...
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`).

## Tombstone

*Only present if `status: rejected`.* What was tried, why it was rejected, what would
change the answer. Preserve the reasoning — do not delete rejected specs.

---

## Agent team config (optional — milestone `M`-files only)

For milestone-sized specs (M1, M2, …) that will be built by an agent team, add this
section. It doubles the spec as the team's playbook.

### Roles by directory ownership

| Role | Owns | Depends on |
|---|---|---|
| core-engine | `src/pricing/`, `src/receipt/` | — |
| adapter-writer | `src/parse/` | core-engine's types |
| cli-surface | `src/cli/` | core-engine's public API |
| test-writer | `test/`, fixtures, goldens | all of the above |

### Dependency waves

```
WAVE 1 — no dependencies (parallel)
  [core-engine] ...
  [test-writer] fixtures

WAVE 2 — depends on wave 1
  [adapter-writer] ...
  [cli-surface] scaffolding only

WAVE 3 — depends on wave 2
  [test-writer] full integration suite
```

### Critical path

Name the role that owns the public API others build against — everyone else coordinates
with it, not the reverse.

### Team prompt

The exact prompt to paste into Claude Code to spawn the team (roles, model assignment,
what to build first, coordination rule). Keep it self-contained — a fresh lead should be
able to run it without reading anything else.
