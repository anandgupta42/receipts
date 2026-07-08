# Changelog

All notable changes to `aireceipts-cli`. Factual, grouped by conventional-commit
type (I6: a log, not marketing). Dates are UTC.

## v0.5.0 — 2026-07-08

Minor: PR receipts gain a **self-contained CI path** (no external reusable workflow), the
default **statusline** gets richer, and the **samosa tip link** leaves the default PR-posted
surfaces (now opt-in). Two deliberate output changes — statusline default and the PR-posted
footer — both called out below.

### Added

- **Self-contained `pr-check`** (SPEC-0064 R2–R7): an adopter's own workflow can run
  `npx -y aireceipts-cli@latest pr-check` in a single job — **no reusable-workflow `uses:`**,
  no org Actions-policy gate — to fetch the branch's receipt ref, render + sanitize it, and
  upsert the marked PR comment via `GITHUB_TOKEN` (no local `gh`). Hidden command; for trusted
  same-repo/internal PRs (the two-job reusable workflow stays the hardened path for untrusted
  fork PRs). Also fixes the reusable-caller template, which was missing `pull-requests: write`.

### Changed (deliberate output changes)

- **Richer default statusline** (SPEC-0071): the default line now carries a burn rate (`$/hr`),
  context-window %, abbreviated `M`/`B` token counts, and an inline 5h reset countdown — e.g.
  `[aireceipts] $423 · $80/hr · 501M · ctx 42% · 5h 26% ↺2h13m`. Every segment renders from a
  real payload field or a priced ledger value; nothing is estimated.
- **Samosa tip link off by default** (SPEC-0070): the `buy me a samosa` link no longer appears
  on the surfaces aireceipts posts onto a PR (the comment's `<details>` and the artifact
  footer). Opt back in with `--samosa`; the standalone tip page and the docs-site footer are
  unchanged.

### Internal / CI

- **Incremental mutation testing** (SPEC-0069): Stryker runs incrementally on PRs that touch
  the money paths (`src/pricing/**`, `src/pr/**`), with a nightly full sweep — the same
  anti-gaming moat at a fraction of the wall-clock. No product code change.

## v0.4.0 — 2026-07-07

Minor: PR receipts can now **attach and post themselves**. A receipt travels with the
branch as a sibling git ref and CI renders + posts the comment, so a receipt lands even
when no one runs `pr --post`. Rendered receipt output is unchanged from v0.3.0 (goldens
byte-identical); the new surface is opt-in.

### Added

- **Seamless PR receipts — `store=ref` + pre-push hook** (SPEC-0065): `aireceipts pr
  --store ref` (or `AIRECEIPTS_STORE=ref`) writes the receipt as a **deterministic** git
  object on `refs/receipts/<slug>` — invisible in the tree and PR diff, byte-identical
  across machines (dated from the session's own `endedAt`, never wall-clock). A committed
  `.githooks/pre-push` hook generates and pushes that ref on `git push` (best-effort;
  never blocks a push, no second push). `npm run setup:hooks` activates the hook for a
  clone of this repo; the default store stays `comment`.
- **CI posts the receipt from the ref** (SPEC-0066): a two-job `pr-receipt-check.yml`
  fetches the branch ref, validates and sanitizes the **untrusted, fork-author-controlled**
  payload, renders it through the existing renderer, and upserts one marker comment via
  `GITHUB_TOKEN` — no local `gh` required. Opt-in enforcement
  (`AIRECEIPTS_REQUIRE_PR_RECEIPT=true`) makes **same-repo** PRs require a receipt; **fork**
  PRs always stay notice-only (their transcripts live on the contributor's machine, so CI
  can't generate one). Enforcement is currently coarse — it does not yet distinguish
  agent-built from hand-written PRs.
- **`@latest` distribution pin** (SPEC-0064 R1): the PR-receipt-check caller installs the
  reusable workflow at `@latest`; the moving `latest` git tag is advanced by the release
  workflow on each publish. (SPEC-0064 R2–R4, the npm-native `pr-check` command, remain in
  progress.)

### Performance

- **Faster feedback** (SPEC-0063): in-process sqlite parsing, a goldens compile cache, and
  parallel preflight reduce CLI and preflight wall-clock.

### Security

- The receipt payload that rides on the branch ref is treated as untrusted input — anyone
  who can push a branch, including a fork author, controls its bytes. The CI post path is a
  hardened trust boundary: a field-aware sanitizer (bracket-escape +
  autolink defang for live-markdown fields, fence-guard for fenced `text`, an
  https-allowlist that rejects markdown-breaking characters for artifact URLs), rendered in
  a **token-less** `render` job whose data-only artifact is posted by a separate `post`
  job — golden-gated against an injection corpus.

### Docs

- Adopter kit: a minimally-invasive default plus opt-in tiers for repos that want to turn
  enforcement up (`docs/pr-receipts.md`, `docs/adopt/`).

## v0.3.0 — 2026-07-06

Minor: background-agent (subagent) spend becomes visible on every surface, the
statusline is rebranded and extensible, and receipts get sharper defaults plus
retroactive/first-run tooling. Per the 0.x policy, this minor deliberately
changes rendered output — the callouts below list every change.

### Output changes (deliberate, golden-gated)

- Statusline prefix is now `[aireceipts]` in stdin mode and
  `[aireceipts · <agent>]` in disk-fallback mode (was `[Claude Code]` etc.),
  and the default line appends your official 5h quota window (`5h N%`) when
  Claude Code's payload carries it (SPEC-0062).
- Session receipts draw one `SUBAGENTS (N)` row (with `TOTAL` covering it) when
  the session has child transcripts; SPEC-0061 itself adds nothing to childless
  sessions (their v0.2.0→v0.3.0 rendering differences come only from the
  SPEC-0054/0055 changes above).
- The receipt footer now carries the install CTA (`npx aireceipts-cli`) instead
  of the samosa link, and the inline methodology paragraph moved behind
  `--methodology` (SPEC-0055).
- The `same tokens on <model>` line gains a `(N% less)` suffix when it is real
  savings (SPEC-0054).

### Added

- **Subagent rollups everywhere** (SPEC-0060, SPEC-0061): PR comments aggregate
  each contributor's subagents into one fence row plus a capped details table;
  session receipts, the statusline, the `install-hook` mini-receipt, and
  `--json` (optional `subagents` object) fold the same priced atoms in, with
  floor caveats for anything unreadable or unpriced — never a fabricated `$`.
- **Statusline v2** (SPEC-0062): `--format <segments>` engine
  (`brand,cost,tokens,waste,quota5h,quota7d,quotaEta`); `quotaEta` is a
  labeled `≈` cap-crossing estimate from two observed readings, rendered only
  when its guards hold (state file: `~/.aireceipts/quota-window.json`).
- **`--details`** (SPEC-0054): opt-in receipt section — token/cache anatomy,
  turns, peak turn, cache-read repricing, BY MODEL split.
- **`backfill`** (SPEC-0056): bulk retroactive receipts for every existing
  session on disk.
- **`--demo`** (SPEC-0051): a bundled sample session renders a real receipt on
  a machine with no sessions yet; both empty-state messages point at it.
- **`setup` + `integrations`** (SPEC-0050): first-run report and exact local
  integration snippets for Claude Code, Codex, opencode, Cursor, and GitHub.
- **Savings slip** (SPEC-0059): could-have-saved handoff block and PR section.
- **`--version`**, NOTICE file, and the OIDC release pipeline (#134); OpenSSF
  Scorecard, community files, and CI telemetry default-off (#139).
- Per-agent docs pages for the five supported agents (SPEC-0058); discovery
  now flags unreadable sessions instead of silently skipping them (SPEC-0045).

### Fixed

- Weekly-digest delta-direction labels now match the sign of the change
  (SPEC-0008, #150).
- spec-lint catches duplicate spec ids across filenames (#136).

### Docs

- README rebuilt PR-receipt-first with a real merged-PR receipt comment as the
  hero, then trimmed to one receipt showing per format (SPEC-0053, #153).
- Positioning pass across README/FAQ/landing (SPEC-0048/0049); Show HN launch
  kit and GTM sequencing docs; statusline docs cover the new segments and the
  host refresh-cadence limitation.

## v0.2.0 — 2026-07-05

Minor: adds adoption telemetry + a local `stats` command (SPEC-0043), and lands
the security/privacy hardening from the v0.1.0 release-board findings (which were
live in v0.1.1).

### Added

- Adoption telemetry v2 (SPEC-0043): a nine-event catalog (feature-usage events,
  activation milestones), a pseudonymous random-UUID install identity sent only as
  a salted hash, and a local receipts counter — all content-free, opt-out, and
  disclosed in the updated first-run notice. (#110)
- `aireceipts stats` — a new command that prints your local receipts-generated /
  total-runs / first-run counts from `~/.aireceipts/state.json`; works fully
  offline and even with telemetry disabled, and never leaves your machine. (#110)

### Fixed

- PR-receipt cost confidence — the implemented slices of SPEC-0044 (the spec
  stays `building`: its `--self-check` kill-criterion and cost-model docs are
  still pending, so it is not flipped to `shipped`):
  - Every contributor drop/degrade/lower-bound now routes through a typed
    `ConfidenceEvent` and surfaces in the PR receipt — no more silent drops (the
    mirror of the #87 over-credit bug); a compile-time exhaustive switch + a
    hygiene guard make "no silent wrongness" a property. (#117)
  - Oracle-independent cost matrix (scenario × agent). (#120)
  - Receipt rows now sum to the displayed total. (#121)
  - Cache-write lower-bound caveat, only when actually under-priced. (#122)
  - Silent parse-skip and load-failure drops surfaced. (#123)
  - Grandchild subagent counted once, not twice. (#124)
  - `src/pr/**` mutation-gated + the silent-drop guard broadened. (#126)
- Strip terminal escape sequences (ANSI/CSI/OSC/nF) and C0/C1 control characters
  from all transcript-derived display text — session titles, tool names, and
  model-mix labels — across every adapter. A crafted transcript could previously
  emit raw escapes to the operator's terminal (e.g. recolor output or retitle the
  window via OSC-0). (#112)
- `aireceipts --list --json` on zero sessions now emits valid JSON `[]` on stdout
  with the message on stderr, instead of plain text that broke `| jq`. (#112)
- `aireceipts --telemetry-show` — the command that previews what telemetry would
  be sent — no longer records or flushes a `cli_run` event itself; previewing
  telemetry sent telemetry. (#115)
- Bump the summary-cache version so titles cached by the pre-sanitizer parser are
  re-parsed rather than served raw. (#112)

### Docs

- Correct README/getting-started privacy and coverage claims (transcripts/code
  never uploaded; diagnostics are opt-out; supported-agent list is finite);
  sync `docs/telemetry.md` agent-type enums and kill-switch examples; correct the
  `week --json` and `source` entries in `docs/json-schema.md`; drop a stale
  pre-release note. (#115)

### Chore

- Restructure the opencode combinatorial unit test: validate all summaries from
  one `listSessions()` and deep round-trip only a structural-coverage sample,
  instead of reopening the SQLite DB per session (6m40s → ~20s, coverage
  retained). Local `preflight-release.mjs` sets `AIRECEIPTS_SKIP_STRESS=1` so the
  spawn-heavy 100-session e2e stress case doesn't wedge on throttled dev macOS;
  CI runs the full suite (env unset), so coverage is unchanged.
- Ledger: SPEC-0040/0041/0042 flipped to `shipped` (they shipped in v0.1.1);
  `AGENTS.md` current-state inventory brought up to date; `CHANGELOG.md` added.

## v0.1.1 — 2026-07-04

First release through the OIDC trusted-publishing workflow (v0.1.0 was the manual
bootstrap).

### Added

- Parse Codex compaction records (`compacted` + `context_compacted`) into the
  normalized model, so `context-thrash` can fire on Codex sessions. (SPEC-0040)
- Real-session discovery filter: exclude workflow-journal artifacts under
  `subagents/` from listings; floor all-zero artifacts out of aggregate windows.
  (SPEC-0041)
- `--handoff` resume packet: a deterministic state header, a `covers:` line, and a
  versioned `--handoff --json` surface. (SPEC-0042)

### Chore

- Size two long-running SQLite test timeouts for macOS background-QoS throttling
  of vitest-spawned children; CI unaffected. (#111)

## v0.1.0 — 2026-07-04

Initial public release: the receipt engine and its full surface (parse adapters,
cited price tables, per-tool attribution, waste lines, compare, week, budget,
handoff, PR receipts, SVG/PNG export, templates, disclosed opt-out telemetry).
