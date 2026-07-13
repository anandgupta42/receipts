# AGENTS.md — aireceipts constitution

*This file is the operating manual (design rationale: `docs/internal/harness.md`). Reading order when documents disagree: AGENTS.md (process + invariants) → specs/SPEC-0000 (product) → the active spec → the matching skill. ≤150 lines,
enforced by CI — if you're adding to it, cut something first.*

## Mission

aireceipts is a local, deterministic CLI that reads AI coding-agent transcripts off disk
(Claude Code, Codex, and other agents) and prints a **cost receipt** for the session: a
per-tool cost/time breakdown, waste lines (loops, downgrades, redundant work), a
an honest cheaper-model story (price-delta arithmetic + routable-spend estimate —
never "model X would have done it" predictions; `compare` measures that), and a compact
handoff block the user can paste into a PR or chat. No servers, no accounts, no dashboards.

## Stack

Node >=20, TypeScript strict, `tsup` (ESM build), `vitest` (tests), `fast-check`
(property tests on pricing/parsing), Stryker (mutation testing on `src/pricing/**`).

## Verification block (identical to CI — run this before you claim done)

```sh
npx tsc --noEmit;                    echo $?
npx eslint . --max-warnings 0;       echo $?
npx vitest run;                      echo $?
node scripts/verify-goldens.mjs;     echo $?
node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs; echo $?
node scripts/spec-lint.mjs;          echo $?
node scripts/hygiene.mjs;            echo $?
```

**Never pipe these through `tail`/`grep`/`head`.** A pipeline's exit status is the last
command's — piping hides a real failure behind a green-looking summary. Always check `$?`
directly, unmasked. This is the single most common way agents ship broken work undetected.

## File ownership

| Path | Owns | Gate |
|---|---|---|
| `src/parse/` | Vendor transcript adapters (Claude Code, Codex, …) | goldens |
| `src/pricing/` | Pure price-lookup + cost calc functions | **mutation-tested**, fast-check |
| `src/receipt/` | The receipt renderer (text/JSON output) | **golden-gated** (byte-equal) |
| `src/cli/` | Argument parsing, command surface | vitest |
| `data/prices/` | Cited price tables (per vendor JSON) | hook-enforced citations |

No duplicated truths: one renderer, one price schema, one numbering scheme for specs.

## Invariants (I1–I6 — restate in every spec and skill; never violate)

- **I1 — Deterministic; zero model calls; zero network in the product path.** Same
  transcript → byte-identical receipt.
- **I2 — Never fabricate a dollar.** `$` renders only when a dated price-table row
  matches the session's model and date; otherwise render tokens. No silent fallback
  prices.
- **I3 — Every number traceable.** Price rows carry cited `sources:`; the attribution
  methodology is one flag away (`--methodology`) and ships in `--json`; cheaper-model
  lines are labeled (arithmetic vs ≈ estimate), and no line ever claims another model
  would have completed the task.
- **I4 — Local-first; diagnostics + adoption telemetry, disclosed and escapable.** The
  product works fully offline. The only network call is content-free telemetry (Azure
  App Insights): command, coarse buckets, versions, agent type, error class, parse-failure
  signature, feature-usage enums, and a random (never machine-derived) install identifier
  sent only as a salted hash — NEVER transcript content, prompts, file paths, repo names,
  or dollar amounts; raw counts/timestamps never ship as payload fields. First-run notice;
  `--telemetry-show` prints the exact payload; `AIRECEIPTS_TELEMETRY=off` or
  `DO_NOT_TRACK=1` kills it. (SPEC-0002, SPEC-0043.)

- **I5 — The receipt is a byte-stable contract.** Goldens gate all output changes.
- **I6 — Facts, not rankings.** Report what a session cost; never rank models or agents
  as better/worse.

## The maintainer's four buttons

1. Approve/reject spec proposals (drafts never self-approve).
2. One-click cited price-table PRs.
3. Curate the skill surface (agents cannot add or modify skills).
4. Cut release tags (npm publish never happens without the maintainer).

## Current-state inventory

*Updated only by the `release` skill. Keep this section, and only this section, current
after each release — don't hand-edit it elsewhere.*

- **Shipped (npm `aireceipts-cli`, v0.10.0):** the receipt engine and its whole surface
  are live — parse adapters (Claude Code, Codex, Cursor, Gemini, opencode), cited price
  tables, per-tool attribution, waste lines (stuck-loop, trivial-spans, context-thrash
  incl. Codex compactions), price-delta + routable-spend (now with `% less`), `compare`,
  `week`, `--handoff` (resume packet + standing rules + savings slip), local budget
  line, quota context, statusline v2 (brand prefix, quota default-on, `--format`
  segments, labeled `≈` quota ETA — SPEC-0062), subagent rollups on every surface (PR
  fence + details table, session receipt `SUBAGENTS` row, statusline/mini/`--json` —
  SPEC-0060/0061), `--details`, `backfill`, `--demo`, `setup` + `integrations`
  (day-1 kit), per-agent docs pages, PR receipts (multi-session, SHA-anchored,
  artifact/share), SVG/PNG export, receipt templates, the landing + docs sites,
  adoption telemetry + a local `stats` counter command (SPEC-0043), and disclosed
  opt-out diagnostics telemetry; **seamless PR receipts** — a deterministic `store=ref`
  producer writing `refs/receipts/<slug>`, a pre-push auto-attach hook, and CI rendering +
  posting the receipt from the ref via `GITHUB_TOKEN` behind a hardened trust-boundary
  sanitizer with opt-in **same-repo** enforcement (SPEC-0065/0066 — the capability ships in
  v0.4.0; both specs stay `building` for their final slices, listed below); a **self-contained
  npm-native `pr-check`** an adopter runs in its own workflow with no reusable-workflow `uses:`
  and no org Actions-policy gate (SPEC-0064, shipped v0.5.0, #176); a **richer default
  statusline** — burn rate, context %, `M`/`B` tokens, inline 5h reset countdown (SPEC-0071);
  a **terminal-surface statusline** — `statusline --cwd` scoped per-pane session selection with
  attribution guards (confirm-on-load, home-shadow, bounded loads), `statusline.json` item
  config, tmux/starship/pwsh/OSC recipes, poll-safe telemetry, and a `windows-latest` CI job
  (SPEC-0075, v0.8.0), plus the `node:sqlite` bundle fix making sqlite-backed reads ~3.5×
  faster in the published CLI (#214);
  the **samosa tip link off by default** on PR-posted surfaces, behind `--samosa` (SPEC-0070);
  and a faster parse/preflight path — in-process sqlite, goldens compile cache, parallel
  preflight (SPEC-0063) — plus **incremental mutation testing** on the money paths (SPEC-0069);
  **agent auto-attach** — a hidden `hook pre-push` subcommand wired via a committed
  `.claude/settings.json` `PreToolUse` hook that writes+pushes the receipt ref on a branch push
  with no manual command and never blocks the push (SPEC-0073, v0.6.0), completing the two-file
  adopter kit; and **robust attribution** — `git patch-id` recovery credits a session whose SHA
  was orphaned by `--amend`/rebase, with an authorship guard so a cherry-pick can't steal credit
  from a session that already directly claimed the commit (a narrower residual — a cherry-pick
  onto a branch SHA the true author never claims — is documented in the spec's Non-goals)
  (SPEC-0072, v0.6.0); **lower-bound receipts** — every dollar is an explicit
  Standard-API-equivalent floor (`≥ $X`), exports move to schema v2, GPT-5.6 prices via
  cited per-request context tiers, ledger rows sum exactly to `TOTAL`, and parsing fails
  closed on contradictory trace evidence while retaining observable tokens (#242, v0.9.0);
  plus, all v0.9.0: the **statusline model segment + landing meter** (SPEC-0076), the
  **PR-receipt provenance footer** (SPEC-0078), the **samosa story page** (SPEC-0079), and
  **landing SEO/AEO** (SPEC-0080). 47 specs at `status: shipped`.
- **In progress (`building`):** SPEC-0044 cost-attribution confidence — its
  implemented slices ship in v0.2.0 (ConfidenceEvent contract + no-silent-drop,
  cost matrix, rows-sum-to-total, cache-write caveat, parse-skip/load-failure
  drops, subagent double-count fix, mutation-gated PR path); the spec stays
  `building` until its `--self-check` kill-criterion and cost-model docs land.
  SPEC-0065 (seamless producer + hook) — R1–R3/R6 (`store=ref` producer,
  pre-push auto-attach hook, determinism) shipped in v0.4.0; R5 (local `--list`/`week`/
  `stats` reads of `refs/receipts` + prune) is not wired, so it stays `building`.
  SPEC-0066 (CI posts from the ref) — R1–R4/R6 (fetch, validate, sanitize, render, post via
  `GITHUB_TOKEN`, two-job trust boundary) shipped in v0.4.0; R5's agent-built vs
  hand-written enforcement discrimination is not built (opt-in enforcement is coarse —
  same-repo vs fork only), so it stays `building`.
- **Approved, not yet shipped:** the opt-in benchmark (SPEC-0015) client contract only —
  actual send disabled; `benchmark` is otherwise reachable from `--help`.
- **Draft:** SPEC-0039 (human-authored PRs).

## Working here

- Every non-trivial change starts from a spec under `specs/`. See `specs/TEMPLATE.md` and
  `specs/SPEC-0000-product.md`.
- One skill per task type, under `.claude/skills/`. Agents pick the matching skill; they
  do not improvise a workflow.
- Hooks are law: a hook exit code of 2 blocks the action. Don't work around a hook —
  fix what it's rejecting.
