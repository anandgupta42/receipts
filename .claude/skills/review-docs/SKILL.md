---
name: review-docs
description: "Multi-agent review of user-facing docs (README, docs/**, --help text) for simplicity and correctness. Use before any release, after any feature PR that touched docs, or when asked to review docs."
trigger: /review-docs
---

# /review-docs — the docs panel (group review, two lenses)

Docs are product surface. This skill runs **at least two independent agent reviewers in
separate contexts** — never one agent wearing both hats, never the agent that wrote the
docs — then consolidates findings and applies fixes.

## Reviewer A — the cold reader (simplicity)

Prompt an agent that has NEVER seen this repo: it gets README.md (and only what the
README links) and must, in order: (1) say in one sentence what the tool does; (2) run
the quickstart commands verbatim against a fixture; (3) flag every place it stumbled —
jargon, missing steps, buried assumptions, anything it had to guess. Length findings
count: a section a cold reader skips is a section to cut. Deliverable: stumble list +
the one-sentence comprehension check.

## Reviewer B — the correctness auditor

A separate agent (different context; Codex preferred — different model family) audits
every claim against the code:
- Every command/flag in README, docs/**, and `--help` exists and runs with exit 0 on a
  fixture (execute them — don't eyeball).
- Every factual claim maps to code (`file:line`) or a test; overclaims are findings
  (I3: docs never promise more than the code does — "never/always/zero" claims get
  special scrutiny).
- Parity surfaces verified: docs/telemetry.md ↔ zod schemas (the SPEC-0002 test),
  docs/json-schema.md ↔ schema when it exists, help text ↔ args.ts.
- Stale references: renamed flags, removed commands, dead links, version drift.

## Consolidate, fix, record

Merge both lists, dedupe, apply the accepted fixes (docs edits are cheap — default to
fixing, not filing), note rejected findings with one-line reasons. Record the panel's
verdict (reviewers, findings count, fixes applied) in the PR or release notes. Docs
review is BLOCKING for a release; advisory-but-expected for feature PRs.
