---
name: add-issue
description: "File an issue on this repo's GitHub tracker (anandgupta42/receipts) via `gh issue create`. Use when the user asks to file, add, or track an issue for aireceipts. This repo's issues live on GitHub — do not file them into any local or external issue tracker."
trigger: /add-issue
---

# /add-issue — file a GitHub issue on this repo

aireceipts issues belong on the repo itself: **`gh issue create -R anandgupta42/receipts`**
(maintainer directive 2026-07-06). Do NOT file aireceipts issues into local or
external trackers — GitHub Issues is the single source of truth for this repo.

## 1. Parse the request

Extract:
- **title** (required) — short, imperative, one line. Ask once if missing; don't guess.
- **labels** (optional) — only labels that exist: check `gh label list -R anandgupta42/receipts`.
- **body** — everything else. Structure it with the sections below.

## 2. Write the body

Public repo — write for a contributor who has no context from your session:

```markdown
## Problem
<what's wrong, observed behavior, evidence — concrete numbers over adjectives>

## Fix direction
<pointer to the relevant SPEC / module / precedent in this repo, if known>

## Notes
<anything separable: docs-only follow-ups, related-but-distinct observations>
```

Repo conventions still apply inside issue text: no fabricated numbers, no
competitor/inspiration-source comparisons, and any feature-work issue should note
that the fix ships with its SPEC-0043 telemetry events + docs parity in the same PR.

## 3. Create it

```sh
gh issue create -R anandgupta42/receipts --title "<title>" --body-file <(printf '%s\n' "<body>")
```

Prefer `--body-file` (heredoc or process substitution) over `--body` so markdown
survives the shell. Add `--label` flags only for labels verified in step 1.

## 4. Verify and report

`gh issue view <number> -R anandgupta42/receipts` — then give the user the issue
number, title, and URL.
