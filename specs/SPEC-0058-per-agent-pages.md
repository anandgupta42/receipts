---
id: SPEC-0058
title: "Per-agent doc pages — one landing page per supported agent"
status: building
milestone: M5
depends: [SPEC-0010, SPEC-0018, SPEC-0050]
---

# SPEC-0058: Per-agent doc pages — one landing page per supported agent

## Purpose

"Does it work with X?" is the first question every prospective user asks, and
today the answer is scattered: a README table row, the integrations recipes,
adapter comments. This spec adds one page per supported agent under
`docs/agents/` — the canonical, linkable answer for each ("receipts for Claude
Code", "receipts for Codex", …). Each page states the parsing depth honestly
(Cursor's degraded mode is a headline fact, not a footnote — I3/I6), where the
transcripts live on disk, the agent-specific quick start, and pointers to the
existing integration surfaces. Docs-only; no product code changes.
Maintainer-directed (2026-07-05).

## Requirements

- **R1 — Five pages.** `docs/agents/{claude-code,codex,cursor,gemini,opencode}.md`,
  one per adapter in `src/parse/registry.ts`. Uniform structure: what you get
  (depth, honestly stated), where transcripts live (the adapter's actual read
  location), quick start, always-on options (only those that apply to that
  agent), PR receipts pointer, privacy note (read-only, local).
- **R2 — Facts match the adapters.** Every stated transcript location and depth
  claim matches the shipped adapter (`~/.claude/projects`, `~/.codex/sessions`,
  `~/.gemini/tmp/<hash>/chats`, Cursor's `state.vscdb` per-OS paths, opencode's
  platform data dir). Cursor's page leads with the session-totals-only honesty;
  no page claims per-turn depth the adapter doesn't have.
- **R3 — An index and inbound links.** `docs/agents/README.md` lists the five;
  the README's Supported-agents table links each agent name to its page; the
  user guide's integrations page links the index.
- **R4 — A guard against drift.** A test pins: one page per registry adapter
  (a new adapter without a page fails), each page carries the required
  sections, the README table links every page, and Cursor's page contains its
  degraded-mode statement.

## Scenarios

- **Given** a Cursor user landing on `docs/agents/cursor.md`, **When** they read
  the first screen, **Then** they see the session-totals-only limitation stated
  before any promise.
- **Given** a future sixth adapter added to the registry, **When** the test suite
  runs without a matching page, **Then** the R4 guard fails naming the missing
  page.

## Non-goals

- **SEO landing pages on the website.** `site/` is SPEC-0021's receipt-page
  design; docs pages are the linkable surface for now.
- **Per-agent marketing copy.** Pages state facts (I6): what is parsed, from
  where, at what depth — no agent is ranked or recommended.
- **New CLI behavior.** `integrations` recipes already exist (SPEC-0050); pages
  link them rather than duplicating snippets.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1/R4 coverage | registry source names vs `docs/agents/*.md` | exactly one page per adapter source id |
| R1 structure | each page's headings | required sections present (what you get / where transcripts live / quick start / privacy) |
| R2 locations | page text | names the adapter's real read location (spot-pinned per agent) |
| R2 honesty | `docs/agents/cursor.md` | contains "session totals" degraded-mode statement above the first heading's fold (first 15 lines) |
| R3 links | README Supported-agents table | each agent row links `docs/agents/<id>.md`; `docs/agents/README.md` lists all five |

## Success criteria

- [ ] R1–R4 implemented; guard test green.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass unmasked.
