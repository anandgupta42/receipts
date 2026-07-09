---
id: SPEC-0075
title: "Terminal-surface statusline — cwd-scoped, configurable, agent-agnostic (tmux first)"
status: approved
milestone: M5
depends: [SPEC-0007, SPEC-0062, SPEC-0071]
---

# SPEC-0075: Terminal-surface statusline

## Purpose

Claude Code renders `aireceipts statusline` natively (SPEC-0007); Codex and opencode
cannot — neither exposes a command-backed status surface (openai/codex #17827 open;
sst/opencode #8619/#18969 open; SPEC-0074's tombstone records the rejected plugin
detour). The agent-agnostic answer is to render at the **terminal** level: a surface
that can run a command and display one line (tmux's status bar first) shows the line
for every adapter at once, no per-agent hooks. Feasibility was measured on a heavy
reference corpus (1.7 GB Claude Code, 2,557 sessions total): the CLI took ~4.0s, and
CPU-profiling traced 3.08s to a **bundling defect** — tsup emits `import("sqlite")`
(the `node:` prefix stripped) in `dist/`, the import throws `ERR_MODULE_NOT_FOUND`,
and `src/parse/sqlite.ts`'s catch silently degrades every sqlite read to a
`spawnSync("sqlite3", …)` per query. Hand-patching the prefix took the same
invocation to **1.1s**. That fix ships first as its own `fix:` PR (it speeds every
command for every npx user on Node ≥22.5, where `node:sqlite` exists; Node 20/21
keeps the CLI fallback); **this spec assumes it and builds the surface on top**,
staged: cwd-scoped selection + the tmux recipe first, then config/more surfaces.
Serves **I2/I3** (scoping can only *omit* or *verify* — nothing new is computed, and
a line is never attributed to a cwd the session's own data doesn't confirm), **I5**
(default output pinned; the native stdin path untouched), **I1** (no daemon, no
watcher — each render is one process with reads bounded to the scoped project).

## Requirements

*Staged build (SPEC-0062 precedent): stage 1 = R1, R3a, R5, R8; stage 2 = R2, R3b,
R6, R7. The `node:sqlite` fix PR precedes stage 1.*

- **R1 — `--cwd <path>` scoped selection (stage 1).** `aireceipts statusline --cwd
  <path>` selects the newest session **attributed to that path** instead of the
  globally newest (`loadFromDisk` today returns `sessions[0]` from the unfiltered
  recency-sorted `listSessions()` — `src/cli/commands/statusline.ts:73` — which is the
  wrong session whenever another agent ran more recently anywhere on the machine).
  Discovery in `--cwd` mode is **scoped, not post-filtered**: adapters are queried
  for the one project (Claude Code: only the project dir whose name equals the
  **encoded** `--cwd` — encoding via the documented `/`→`-` scheme is deterministic;
  the lossy *decode* direction from `src/aggregate/project.ts:14` is never used for
  matching; Codex/opencode: their summaries' `cwd` field, measured present 652/652
  and 1/1). Matching = normalized equality or path-prefix (a pane deep in the repo
  matches the repo-root session; normalization is platform-aware: case-folded drive
  letters, `\`→`/`, lexical `.`/`..` resolution; prefix means whole path segments —
  `/repo` never matches `/repo-old`). **Home-shadow guard** (found by real-data
  visual e2e during the stage-1 build): a session recorded at the user's home
  directory or above (an agent launched from `~` or `/`) matches its **exact** path
  only — it never ancestor-matches, because one `~`-launched session is an ancestor
  of every path on the machine and would permanently shadow the placeholder.
  Ancestor matching stays for project roots below home and outside it (`/srv/app`
  still matches `/srv/app/sub`); a monorepo rooted exactly at `$HOME` needs the
  exact path — a deliberate, documented trade. **Confirm-on-load:** because the CC encoding collides (`/my-repo`
  and `/my/repo` both encode to `-my-repo`), a candidate matched by directory name
  is confirmed against the loaded session's own `cwd` field (`src/parse/types.ts:126`
  — the SPEC-0019 attribution field PR receipts already rely on); disagreement → not
  a match. No match → the existing neutral no-session placeholder — **never** a
  silent fall-back to another project's session (I2/I3: a wrong line is worse than
  none). Unscoped invocations keep today's global-newest behavior byte-for-byte.
  Cursor sessions carry neither `cwd` (0/41 measured) nor a decodable path and are
  never matched — documented.
- **R2 — persistent item config, Codex-parity (stage 2).**
  `~/.aireceipts/statusline.json` (under `AIRECEIPTS_HOME`, the existing
  `budget.json` convention) holds `{"items": ["brand", "cost", …]}` — an ordered
  list from the SPEC-0062 segment vocabulary, mirroring Codex's `[tui].status_line`
  ergonomics. Precedence: explicit `--format` > config file > `DEFAULT_FORMAT`. An
  explicit `--format` keeps SPEC-0062's fail-fast (exit 1, list on stderr); an
  **invalid config file** (unknown item, bad JSON, wrong shape) degrades to
  `DEFAULT_FORMAT` with one stderr note — a broken dotfile must never blank a status
  bar that polls unattended ("layout never breaks", SPEC-0007). The config applies
  wherever the statusline renders (native included — user-authored config shaping
  the user's own line is the `budget.json` pattern; I5's goldens pin the *default*).
  Config selects **which** honest segments render, in what order; it cannot inject
  text, color, or values outside the vocabulary (I2/I3).
- **R3a — tmux recipe (stage 1).** `docs/statusline.md` + the guide ship a
  copy-paste tmux recipe: `status-right` polling
  `aireceipts statusline --cwd "#{pane_current_path}"` on `status-interval`. tmux is
  the **flagship** surface because it is the only one visible *while* an agent owns
  the terminal — a prompt segment or title only refreshes between commands.
  Coloring/width stay the surface's job (tmux `#[fg=…]`); aireceipts output stays
  plain text (SPEC-0071 R6 stands).
- **R3b — prompt-engine + title recipes (stage 2).** starship + raw zsh/bash
  per-prompt snippets and an OSC terminal-title precmd, each passing `$PWD` to
  `--cwd`. Because prompt latency budgets (starship's 500ms default
  `command_timeout`) sit below Node's ~1s floor, the prompt snippets use an
  async-cached pattern — print the last cached line, kick a fire-and-forget refresh
  for the next prompt; the cache write is atomic and **keyed by cwd** (no
  cross-pane bleed), and the recipe states both the one-prompt staleness and the
  between-commands-only visibility plainly.
- **R4 — the contract, not a catalog.** The docs state the general contract — any
  surface that can run a command and display one line of stdout works; pass your
  pane/prompt cwd to `--cwd` — so screen/oh-my-posh/fish/pwsh/iTerm2 users derive
  their own wiring without aireceipts owning every tool. Claude Code guidance is
  explicit: the native `statusLine` hook stays the recommended surface (richer —
  `context`/`quota*` are stdin-payload-only and structurally absent from any
  disk-fallback render; and faster — `loadById` reads one file, no discovery). The
  terminal surface is additive for CC users, primary for Codex/opencode.
- **R5 — native path untouched (stage 1).** The stdin mode (`loadFromStdinPayload`,
  `statusline.ts:59`) is not modified; `--cwd` only replaces the *disk-fallback*
  selector, and a usable stdin payload wins over `--cwd` (the host knows its own
  session better than any path heuristic). Existing statusline tests keep passing
  unloosened; the default line's bytes are unchanged (I5).
- **R6 — poll-safe telemetry (stage 2).** A `--cwd` invocation is a polled surface:
  it records the SPEC-0043 local counter but **skips the network flush** (a 15s tmux
  poll must not emit ~5,760 events/day — amplification, and the flush costs ~0.4s
  latency per render). The `integration_surface_rendered` schema gains a `scoped`
  boolean and a `configFile` boolean (strict schema, fixtures, `docs/telemetry.md`
  in the same PR; booleans only — never the path or the format string), emitted on
  the non-polled invocations that do flush.
- **R7 — cross-platform proof, not assertion (stage 2).** The cwd
  normalizer/matcher is pure and unit-tested for POSIX and Windows shapes
  (drive-letter case, backslashes, trailing separators, segment-prefix semantics),
  and a `windows-latest` CI job runs those tests plus `statusline --cwd`
  end-to-end on a fixture corpus. Windows recipes = starship/oh-my-posh/pwsh prompt
  + Windows Terminal OSC title (tmux documented as WSL-only). On Node ≥22.5 the
  `node:sqlite` fix removes the `sqlite3.exe` requirement for opencode/Cursor reads;
  Node 20/21 keeps the documented CLI fallback.
- **R8 — measured latency budget (stage 1).** On the reference heavy corpus
  (machine + corpus stats recorded in Validation), `statusline --cwd` end-to-end
  (process spawn to line) stays **≤ 1.5s worst-case** — with the bundling fix
  (measured 1.1–1.2s unscoped) plus scoped discovery (skips the ~0.5s Cursor sqlite
  read and the cross-agent scan) the expectation is ≲ 1s; 1.5s is the pass/fail
  line and the kill criterion's trigger. CI asserts the *in-process* scoped pipeline
  under the existing 200ms-budget pattern (`test/cli/statusline.test.ts:194`); the
  wall-clock number is recorded in Validation, not CI-flaked.

**Kill criterion:** if scoped end-to-end can't hold ≤ 1.5s on the reference corpus,
or cwd matching produces wrong-session lines in real multi-worktree use despite
confirm-on-load, stage 2's prompt-engine recipes are cut and the feature ships
tmux-only (timer surfaces tolerate latency; wrong data is never tolerated).

## Scenarios

- **Given** a Codex session in `/repo` and a newer Claude Code session elsewhere,
  **When** tmux runs `aireceipts statusline --cwd /repo`, **Then** the line is the
  Codex session's (`[aireceipts · Codex] …`), not the newer foreign one.
- **Given** sessions in `/my/repo` and a `--cwd /my-repo` (encoding collision),
  **When** the CC candidate's loaded `cwd` says `/my/repo`, **Then** no match — the
  placeholder renders, never the colliding project's dollars.
- **Given** no session ever ran in `/repo`, **When** `--cwd /repo` renders, **Then**
  the neutral placeholder — never another project's line.
- **Given** only a session launched from `~`, **When** `--cwd /repo` renders, **Then**
  the placeholder (home-or-above sessions match their exact path only); **When**
  `--cwd ~` renders, **Then** that session's line (exact match still allowed).
- **Given** a usable stdin payload **and** `--cwd`, **When** the line renders,
  **Then** stdin wins (native behavior, unchanged).
- **Given** `statusline.json` `{"items":["brand","cost","burn"]}` and no `--format`,
  **When** the line renders, **Then** exactly those segments in that order.
- **Given** a corrupt `statusline.json`, **When** the line renders, **Then** the
  default format renders, one stderr note, exit 0.
- **Given** a tmux poll every 15s for a working day, **When** telemetry state is
  inspected, **Then** local counters advanced and no per-poll network flush occurred.
- **Given** a Windows path `C:\repo\sub` and a Codex session with `cwd` `c:/repo`,
  **When** matching runs, **Then** it matches (case-folded drive, normalized
  separators, segment-prefix rule).

## Non-goals

- **The `node:sqlite` bundling fix itself** — ships first as a standalone `fix:` PR
  with a built-artifact regression test (asserting `import("node:sqlite")` survives
  bundling); this spec depends on but does not contain it.
- **Any daemon, watcher, or background service** — each render is one process (I1);
  the async-prompt pattern is a per-prompt fire-and-forget, not a resident process.
- **In-agent TUI rendering for Codex/opencode** — no surface exists (codex #17827,
  opencode #8619/#18969); revisit the moment either ships a command-backed hook.
- **`context`/`quota*` segments outside CC-native** — stdin-payload-only facts;
  rendering them from disk would be fabrication (I2/I3).
- **Cursor scoping** — no `cwd` on Cursor sessions (0/41); unpriced anyway; never
  matched, documented.
- **Per-surface config blocks / an interactive `--configure` picker** — `--format`
  covers per-surface divergence; a picker is v2 polish.
- **Colors/ANSI from aireceipts** — the surface owns presentation (SPEC-0071 R6).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 scoped pick | Codex session cwd `/repo`, newer CC session elsewhere, `--cwd /repo` | Codex line renders |
| R1 prefix match | session cwd `/repo`, `--cwd /repo/sub/dir` | matches |
| R1 sibling rejected | session cwd `/repo`, `--cwd /repo-old` | no match (segment-prefix, not string-prefix) |
| R1 CC encoded match | CC project dir `-my-repo`, `--cwd /my/repo`, loaded cwd `/my/repo` | matches |
| R1 collision guarded | CC project dir `-my-repo`, `--cwd /my-repo`, loaded cwd `/my/repo` | no match, placeholder |
| R1 no match | `--cwd /never-used` | neutral placeholder, exit 0 |
| R1 home-shadow guard | only a `~`-launched session exists, `--cwd /never-used` | placeholder (home session never ancestor-matches) |
| R1 cursor excluded | only a Cursor session for the cwd | placeholder (never matched) |
| R1 unscoped unchanged | no `--cwd`, no stdin | today's global-newest line, byte-identical |
| R2 config renders | `statusline.json` items `brand,cost` | exactly those, in order |
| R2 precedence | config file + explicit `--format tokens` | `--format` wins |
| R2 corrupt file | invalid JSON / unknown item / wrong shape | default format, stderr note, exit 0 |
| R2 AIRECEIPTS_HOME | config under overridden home | honored (existing convention) |
| R2 flag fail-fast | `--format bogus` (config valid) | exit 1, list on stderr, empty stdout |
| R3a recipe present | `docs/statusline.md` after stage 1 | tmux snippet exists, passes `#{pane_current_path}` to `--cwd` |
| R3b recipes present | docs after stage 2 | starship-async (atomic, cwd-keyed cache; staleness + visibility notes) and OSC-title snippets |
| R4 contract + CC guidance | docs after the PR | run-a-command contract stated; CC-native recommended with the ctx/quota reason |
| R5 native untouched | stdin payload invocation, before/after | byte-identical line; existing tests unloosened |
| R5 stdin + `--cwd` | usable payload and a `--cwd` flag | stdin wins |
| R6 poll no-flush | `--cwd` invocation | local counter advanced, no network flush |
| R6 telemetry booleans | non-polled scoped/config runs | `scoped`/`configFile` present, strict schema passes |
| R7 win paths | `C:\repo\sub` vs `c:/repo` | match (unit, runs in windows-latest CI) |
| R7 posix paths | trailing `/`, literal-hyphen dirs | match rules hold |
| R8 in-process budget | scoped pipeline on children fixture | within the 200ms in-process budget |

## Success criteria

- [ ] Stage 1 (R1, R3a, R5, R8) shipped after the `fix:` PR; stage 2 (R2, R3b, R6,
      R7) on the same spec.
- [ ] tmux recipe verified live on macOS/Linux showing the scoped line; wall-clock
      ≤ 1.5s recorded in Validation on the reference corpus.
- [ ] `docs/statusline.md`, the guide page, `docs/telemetry.md`, and the
      `integrations` recipe updated in the same PR as the code they describe.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass unmasked
      (`echo $?`).

## Validation

*2026-07-09 — S1 self (Fable), S2 Codex (independent, read-only), S3 worth gate,
S4 lint. Feasibility evidence: profiled CLI 4.0s → 3.08s in `spawnSync sqlite3`;
`dist/chunk-*.js` emits `import("sqlite")` (prefix stripped) vs source's
`import("node:sqlite")`; hand-patched chunk re-timed at 1.1–1.2s; per-adapter cold
discovery: claude-code 84ms/1,863, codex 54ms/652, cursor ~0.5s/41, opencode 6ms/1;
worst-case pricing pipeline (136 MB Codex session) 0.66s; cwd coverage: codex
652/652, opencode 1/1, claude-code 0/1,863 (path-encoded), cursor 0/41.*

- **S1:** every rendered value is an existing SPEC-0007/0062/0071 value — this spec
  adds *selection and placement*, no new numbers; scoping can only omit (placeholder)
  or verify (confirm-on-load), so I2/I3 are structurally preserved; I5 pinned by the
  unscoped-unchanged and native-untouched matrix rows.
- **S2 (Codex) — accepted, fixed in this draft:** `node:sqlite` absent on Node
  20/21 → fix-PR claim scoped to Node ≥22.5, fallback documented (R7); CC `-`→`/`
  *decode* is lossy (`/my-repo` ≡ `/my/repo`) → matching now uses the lossless
  *encode* direction plus confirm-on-load against the session's own `cwd`
  (SPEC-0019 field), collision scenario + matrix row added; "scoping skips the scan"
  was asserted, not specified → R1 now requires scoped discovery, not
  post-filtering, and "one process, one read" reworded; per-poll telemetry flush
  amplification (~5,760 events/day) + 0.4s latency → R6 makes `--cwd` polls
  local-count-only; starship/title are invisible while an agent owns the terminal →
  tmux promoted to flagship (R3a, stage 1), prompt recipes staged with visibility +
  staleness disclosed (R3b); missing matrix rows (sibling prefix, collision,
  literal hyphen, `AIRECEIPTS_HOME`, stdin+`--cwd`, unscoped-unchanged, poll
  no-flush) → added; 8 Rs too many → staged build, stage 1 = R1/R3a/R5/R8.
- **S2 — noted, overridden with reasons:** *"R2 config contradicts I5/R5"* — I5's
  goldens pin *default* output; a user-authored config shaping the user's own line
  is the established `budget.json` pattern, and stdin-mode precedence is unchanged;
  R2 kept (maintainer explicitly picked configurability, 2026-07-09 session) but
  moved to stage 2 — adopting Codex's risk-ordering while keeping the picked scope
  (the SPEC-0062 precedent). *"Reject; tmux-only v1"* — stage 1 *is* effectively
  tmux-only; the staged spec preserves the approved scope without a second
  approval round.
- **S3 — worth:** *Who/how often:* the maintainer's own multi-agent workflow
  (Codex + opencode + Claude Code, requested interactively 2026-07-09) and any
  multi-agent user with a terminal surface — recurring, every working session;
  Codex/opencode users currently have **no** statusline at all. *Do-nothing:* the
  4s-per-render bundling bug persists for every npx user (the fix-PR alone is worth
  shipping regardless of this spec), and Codex/opencode users keep flying blind
  between receipts. *Smaller fix:* the unscoped doc snippet — rejected because
  global-newest shows the wrong session's dollars on multi-agent machines, the
  exact dishonesty aireceipts exists to avoid. *Steelman the cut:* the live-visible
  cohort is tmux users, and prompt surfaces are stale-by-one-prompt — countered by
  staging (tmux first) and by the kill criterion cutting stage 2 if the pattern
  proves fiddly. *Kill-criterion dry-run:* the 1.1s measured post-fix baseline says
  ≤1.5s scoped is realistic; if not, tmux-only survives. **Verdict: build now,
  staged (fix-PR → stage 1 → stage 2).**
- **S4:** `node scripts/spec-lint.mjs` — pass.
