# Changelog

All notable changes to `aireceipts-cli`. Factual, grouped by conventional-commit
type (I6: a log, not marketing). Dates are UTC.

## v0.9.1 — 2026-07-13

Patch: **the SPEC-0073 auto-attach hook now fires for the commands coding agents
actually run** (fixes #241, PR #252). `hook pre-push` previously refused any Bash
command with more than one tokenized invocation, and a trailing `2>&1` defeated
even a single plain push — so chained agent pushes (`git add && git commit && git
push`, `git push 2>&1 | tail`) never attached a receipt ref. The issue's "worktree"
correlation was an agent-command-style correlation. Now: shell redirections are
stripped per invocation, the hook attaches once when at least one invocation is an
unambiguous branch push, any `cd`/`pushd`/`popd` in the command still refuses (the
push may target a different repo than the hook's cwd), and heredoc payloads keep
refusing via an explicit guard. SPEC-0073 R1 amended accordingly.

Also hardened the adopter kit (org-rollout review finding): the hook commands in
`docs/adopt/claude-settings.json`, `docs/adopt/codex-hooks.json`, the
`docs/pr-receipts.md` snippets, and the `integrations` command's recipes now end
`|| true` — an `npx`/registry failure can never block a push.

## v0.9.0 — 2026-07-13

Minor: **receipt dollars are now explicit observable lower bounds — `≥ $X`, never an
exact-looking bill — and the `--json` export schema moves to v2 to say so in a
machine-readable way.** A second, deeper cost-correctness pass after v0.7.1's #196:
PR #242 fixed real undercounting (a commit/amend truncation had sliced a `$0.44`
receipt out of work independently reconstructed at `≥ $44.97`, issue #239) and made
every surface state what the number is and what it excludes.

### feat

- **GPT-5.6 (Sol/Terra/Luna) sessions are now priced.** The price schema gained
  per-request context tiers (`context_tiers`, `input_cache_write`), so Codex request
  envelopes select the cited `>272K` Standard tier per request; the unpersisted
  cache-write quantity stays outside the floor with a caveat. GPT-5.5 remains
  tokens-only because its published long-context threshold is full-session scoped,
  which a request stream cannot select honestly (PR #242, cited from the official
  model pages in `data/prices/openai.json`).
- **Statusline model segment + the meter** (SPEC-0076, PR #233): the statusline can
  show the session's model mix, and the landing page gained the meter story and
  redesign.
- **PR-receipt provenance footer** (SPEC-0078, PR #236): posted receipts carry a
  footer stating how the numbers were produced and where the raw data lives.
- **Samosa story page** (SPEC-0079, PRs #238/#240): a Ko-fi tip jar behind an
  own-surfaces-only story page; a single Sponsor row and README section link to it.
  Receipts, PR comments, and artifacts never carry the tip link by default.
- **Landing SEO/AEO** (SPEC-0080, PR #243): share cards, JSON-LD, sitemap, `llms.txt`.
- Exports: schema v2 adds `minUsd` lower-bound estimates (`kind: "lower-bound"`,
  `basis: "standard-api-list-price-equivalent"`), exact parent/child/combined
  unpriced-token vectors, explicit dollar/token scopes, combined pricing-coverage
  fields, and tool-CSV granularity warnings (PR #242).

### fix

- **Cost attribution across all agents** (PR #242, fixes #239): PR anchors resolve
  one recovered SHA-alias truth for contributor selection, slicing, per-commit rows,
  and same-session amend lineage (with HEAD-change barriers so a branch switch can
  never pull a foreign commit into a slice). Codex parsing gains replay dedupe,
  inherited-baseline removal, model/provider switching, exact cumulative/last
  reconciliation, and fail-closed handling of malformed/reset/mixed streams — every
  observable envelope is retained as tokens even when pricing must be refused.
  Claude Code deduplicates by `message.id` and keeps id-less usage as one
  unattributed envelope; malformed counters can never become priceable zeroes.
  OpenCode prices provider-aware and reconciles aggregates componentwise —
  contradictory vectors are excluded, never fabricated.
- **Uncited cache rates contribute zero with a caveat** — no fallback to an uncited
  input rate, ever (I2).
- Displayed ledger rows sum exactly to `TOTAL`, and no displayed amount ever exceeds
  its raw value; tiny positive floors keep up to twelve decimals rather than
  collapsing to `$0.0000` (PR #242).
- Detector language: flagged patterns read `FLAGGED PATTERN COST ≈ … · not proven
  savings` — no "waste floor" claim (PR #242).
- **PR receipt attachment is reliable across Codex and CI** (PR #232).

### BREAKING / migration from schemaVersion 1

`--json` `schemaVersion` is now `2`. `totalUsd` is scoped to the **parent session
only** and is an explicit lower bound (rounded down); the old combined meaning lives
in `combinedPricedUsd` / `combinedPricedCostEstimate`. Scripts that consumed v1's
`totalUsd` should check `schemaVersion` and read the combined fields if they want
parent+subagent totals. All dollar fields carry lower-bound semantics objects; known
unpriced usage is exported beside the floor instead of disappearing. Details in
`docs/json-schema.md`.

## v0.8.2 — 2026-07-10

Patch: **the auto-attach hook now fires on bare-`HEAD` branch publishes** —
`git push -u origin HEAD` (and `--force-with-lease` / `HEAD:refs/heads/<x>` forms), the
dominant idiom for coding agents, previously classified as not-a-branch-publish and the
SPEC-0073 hook silently wrote no receipt ref. Root-caused from the org dogfood pilots
producing zero receipts (issue #228, PR #230): the sibling hook on the same event fired
while ours declined classification. The receipt ref slug always derives from the
resolved checked-out branch; detached `HEAD` still attaches nothing (fail-safe), and
tag/sha/receipt-ref/delete publishes stay excluded.

Also: docs — terminal-statusline pages now say what happens without tmux (silent
fallback + alternatives, #226) and add a shell-wrapper recipe so the statusline appears
whenever the agent launches (#225).

## v0.8.1 — 2026-07-10

Patch: **OpenAI `gpt-5.6` family price rows** — `gpt-5.6-sol` ($5.00 in / $0.50 cached /
$30.00 out per 1M), `gpt-5.6-terra` ($2.50 / $0.25 / $15.00), `gpt-5.6-luna` ($1.00 /
$0.10 / $6.00); Standard short-context tier, effective 2026-07-09, every row cited to
the official OpenAI pricing page (PR #223). Codex CLI sessions on these models — which
rendered tokens-only under I2's no-fabricated-dollars rule — now price in receipts and
the statusline. Additive data change only; no code touched.

Also: the README was restructured around a features-first flow with an agent-assisted
install section ("point your agent at this README and it installs + wires the
statusline"), contributed in PR #213. Docs-only; ships as the npm package README.

## v0.8.0 — 2026-07-10

Minor: **the statusline now works at the terminal level — tmux, starship, zsh/bash,
PowerShell, terminal titles — so Codex and opencode sessions get a live cost line too,
not just Claude Code.** Neither Codex nor opencode exposes a command-backed status hook
(openai/codex#17827 and sst/opencode#8619 are open), so the surface moved to the
terminal itself (SPEC-0075, PRs #217/#221).

### feat

- `aireceipts statusline --cwd <path>` selects the newest session **attributed to that
  path** instead of the machine's globally newest one, so a tmux `status-right` line
  (`--cwd "#{pane_current_path}"`) shows each pane its own session. Attribution is
  guarded: Claude Code's lossy project-directory encoding is confirmed against the
  transcript's own recorded `cwd` after load, sessions launched from the home directory
  (or `/`) never ancestor-match everything, dot-segments resolve lexically, full-parse
  work is capped, and no match renders the neutral placeholder — never another
  project's line. Cursor sessions carry no cwd and are excluded. Relative paths resolve
  against the invocation directory; a usable Claude Code stdin payload still wins.
  Recipes for tmux, starship, plain zsh/bash, PowerShell, and OSC terminal titles are
  in `docs/statusline.md` — the Claude Code native `statusLine` hook remains the
  recommended (richer, faster) surface where it exists (PRs #217, #221).
- `~/.aireceipts/statusline.json` (`{"items": ["brand", "cost", …]}`) sets a persistent
  default segment list for the statusline. Precedence: explicit `--format` > config
  file > built-in default. An invalid file degrades to the default line with one stderr
  note (exit 0); the `--format` flag keeps its fail-fast contract (PR #221).
- Telemetry: `--cwd` invocations are polling surfaces, so they count locally but never
  network-flush (a 15-second tmux poll adds zero events). The
  `integration_surface_rendered` event gains `scoped` and `configFile` booleans — never
  the path or the format string (`docs/telemetry.md`, PR #221).

### fix

- **The published CLI is ~3.5× faster wherever sqlite-backed sessions (opencode,
  Cursor) are read** (PR #214). tsup's `removeNodeProtocol` default rewrote
  `import("node:sqlite")` to `import("sqlite")` in `dist/`, which fails at runtime, so
  every published build silently fell back to spawning the `sqlite3` CLI per query —
  measured 4.0s → 1.15s for one statusline render on a sqlite-heavy machine. On
  Node ≥ 22.13 the `sqlite3` binary is no longer needed at all; older runtimes keep the
  fallback. Built-artifact regression tests now pin the import specifier and the
  in-process read path.

### chore

- CI gains a `windows-latest` job (cwd matching, statusline suites, built-CLI e2e). Its
  first runs surfaced and fixed three real Windows issues: `.cmd` spawns need a shell
  under Node's CVE-2024-27980 hardening, goldens/fixtures gained `-text` line-ending
  exemptions, and absolute POSIX paths are never drive-prefixed by `path.resolve`
  (PR #221).
- OpenSSF Scorecard hardening: esbuild override for the open advisory, absolute
  `SECURITY.md` link (PR #212); adopter `pr-check` workflow hardened with
  `continue-on-error` + concurrency groups (PR #207).

Rendered receipt output is byte-identical (receipt goldens unchanged; the help golden
gains the `--cwd` line); the default statusline
line renders through the exact same code path as 0.7.2 when neither `--cwd` nor a
config file is present.

## v0.7.2 — 2026-07-09

Patch: **PR-receipt refs are now written under `refs/aireceipts/*` instead of the generic
`refs/receipts/*`.** The old namespace collided with other tools that also publish to
`refs/receipts/<slug>` (e.g. an attestation producer storing an in-toto `receipt.json` at
the same path). In a repo running both, the namespace was occupied by the other tool's
payloads, so CI `pr-check` fetched a foreign ref, failed its `schemaVersion` check, and
silently posted nothing — the auto-attach hook fired and pushed refs, yet no receipt ever
appeared. aireceipts now owns `refs/aireceipts/*` and never reads or writes
`refs/receipts/*`, so the two coexist; the push classifier still recognizes both namespaces
so a foreign receipt-ref push is never mis-counted as a branch commit (PR #204). No
migration: aireceipts had never written a `refs/receipts/*` ref. Hooks and CI on `@latest`
adopt the new namespace together on this release. Rendered receipt output is byte-identical
(goldens unchanged); the only user-visible surface change is the ref name in `pr --help`.

## v0.7.1 — 2026-07-09

Patch: **Claude Code receipts were multiplying repeated response snapshots by ~2.5–3×; response-group deduplication removed that over-count.**
Claude Code writes one `assistant` transcript record per content block of a response, and
every record of that response repeats the same `message.id` and a byte-identical `usage`
snapshot. The adapter had counted each record as its own billed turn, multiplying a
response's tokens by its block count. Turns are now deduped by `message.id` — the first
record of a response books its usage once, later records only add their tool calls — so
`turnCount` and each observable Standard-API floor book the documented response group once
(PR #196). **After upgrading, affected Claude Code receipts show lower floors and fewer
turns than 0.7.0 showed for the same session**: legacy output for one local session changed
from `$102.97` to `$36.69` (2.81×), and one PR slice from `$5.17` to `$1.61`. Those are
historical CLI values, not invoice amounts. This was a silent **over**-count of observable
usage. Codex, opencode, and Cursor were unaffected by that duplicate-snapshot bug; the
then-current Codex token reconciliation was rechecked, but did not establish commercial
invoice exactness. Synthetic-fixture output is byte-identical (goldens
unchanged); the summary-cache version was bumped (2 → 3) so stale inflated totals recompute
on the next run. Receipts posted on this repo's own past PRs carry per-session correction
blocks with recomputed observable floors. Full audit and evidence: PR #196,
`docs/cost-model.md`, and the 2026-07-08 addendum in
`docs/internal/cost-attribution-evidence.md`.

## v0.7.0 — 2026-07-08

Minor: **telemetry now defaults to enabled in CI**, reversing the v0.6.x CI-default-off behavior.
Automated CI runs (e.g. the `pr-check` action) are now counted by default, so CI adoption shows up
in the data. CI is no longer special-cased — the `isCI` field still distinguishes CI from human
runs. **Both kill switches still win everywhere**: set `AIRECEIPTS_TELEMETRY=off` (or `0`/`false`)
or `DO_NOT_TRACK=1` to disable telemetry in CI or anywhere; an empty/malformed connection string
also disables. Telemetry payloads remain content-free (no transcript, prompts, file paths, repo
names, or dollar amounts — invariant I4). See SPEC-0002's 2026-07-08 amendment and `docs/telemetry.md`.

## v0.6.1 — 2026-07-08

Patch: the agent auto-attach hook (SPEC-0073) shipped with a 10s `timeout` — too tight for its
**first** `npx -y aireceipts-cli@latest` run on a cold npm cache (which downloads the package,
including the `@resvg/resvg-js` native dep, before it can write the ref). On a fresh clone the
first push could hit the timeout and silently skip its receipt. Bumped the pre-push hook timeout
to **60s** (still bounded — the push is never gated on the receipt). The SessionEnd `--mini` hook
timeout is unchanged (10s). No other behavior change; rendered output is byte-identical.

## v0.6.0 — 2026-07-08

Minor: receipts can now be produced **automatically** on push, and PR attribution is more
robust. No change to rendered receipt output (goldens byte-identical); both additions are
opt-in / internal.

### Added

- **Agent auto-attach** (SPEC-0073): a hidden `aireceipts hook pre-push` subcommand, wired as a
  Claude Code `PreToolUse` hook via a committed `.claude/settings.json`, writes and pushes the
  receipt ref (`refs/receipts/<slug>`) when the coding agent runs a branch push — so a receipt
  is produced with no manual command. It **never blocks the push** (exits 0 on every path, no
  stdout, bounded by the hook timeout) and only acts on a real `origin`/current-branch push
  (tokenized detection; skips dry-run/delete/tags/non-origin/repo-retargeting/`refs/receipts`).
  The adopter kit is now **two files** — the `pr-check` workflow (produces nothing on its own)
  plus the `.claude/settings.json` hook (`docs/adopt/`, `aireceipts integrations`).

### Fixed

- **Robust PR-receipt attribution** (SPEC-0072): a session whose commit SHA was orphaned by
  `git commit --amend` (or rebase) is now correctly credited by matching its stable
  `git patch-id` to the branch commit, instead of showing "no branch commit" while an unrelated
  helper takes the credit. Strictly under-crediting — duplicated diffs, empty/merge commits, and
  a diff already directly claimed by another session never produce a match (no fabricated or
  stolen credit, I2). Adds an `unanchored-git-write` confidence signal that floors the total when
  a real git-write can't be tied to the branch.



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

- **Richer default statusline** (SPEC-0071): the default line added a floor rate (then rendered as `$/hr`),
  context-window %, abbreviated `M`/`B` token counts, and an inline 5h reset countdown — e.g.
  legacy example: `[aireceipts] $423 · $80/hr · 501M · ctx 42% · 5h 26% ↺2h13m`.
  Current output qualifies those dollar values with `≥`; they are observable Standard-API
  floors/floor rates, not invoice charges. Every segment renders from a payload field or
  priced-floor ledger; only explicitly `≈` arithmetic is estimated.
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
- The `same tokens on <model>` line gained a `(N% less)` suffix in that release;
  current output calls this a lower observable-floor difference, not realized savings (SPEC-0054).

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
- **Savings slip** (SPEC-0059, legacy name): the current handoff/PR section is
  labeled `FLAGGED PATTERN COST ≈` and explicitly says it is not proven savings.
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
