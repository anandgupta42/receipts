---
id: SPEC-0074
title: "opencode statusline plugin — surface the line via session.idle → state file"
status: rejected
milestone: M5
depends: [SPEC-0007, SPEC-0062, SPEC-0050]
---

# SPEC-0074: opencode statusline plugin

## Purpose

`aireceipts statusline` already renders a correct line for opencode sessions in
disk-fallback mode (`[aireceipts · <opencode label>]`, SPEC-0062 R1) — the CLI side is
done. What's missing is a way to *surface* it inside an opencode workflow the way Claude
Code's `statusLine` config does. opencode has **no** stable native footer/statusline render
hook yet (open feature requests: opencode #8619 `ui.statusLine`, #18969 `ui.footer`, #23539
status-bar widgets), so an in-TUI footer render is not available. It **does** have a stable
plugin system: a plugin receives `$` (Bun shell) and an `event` catch-all hook, loaded via
`tui.json`'s `plugin` array. This spec ships a thin opencode plugin that, on
`session.idle`, runs the already-working CLI and writes the one line to a **state file** an
external statusline surface (tmux / shell / starship) displays — the same file-exposure
pattern the community `opencode-subagent-statusline` package uses. Serves **I1** (the plugin
adds zero network — it only invokes the deterministic CLI), **I2/I3** (nothing new is
computed; the line is the CLI's existing honest output — tokens-only when unpriced, never a
fabricated `$`), and **I5** (the shipped plugin snippet is generated from a tested helper so
it can't drift). Research-derived; see the conversation's Codex/opencode capability audit.

## Requirements

- **R1 — thin `session.idle` plugin.** Ship an opencode plugin (source in-repo,
  distributed through the integration recipe, R4) that subscribes the `event` hook and, on
  `event.type === "session.idle"`, runs `aireceipts statusline` via Bun `$` and writes
  stdout's single line to a state file. The plugin carries **no** parse/pricing/policy logic
  — the existing opencode recipe rule (`src/setup/integrations.ts:124` — "No parser,
  pricing, or receipt policy logic belongs in the assistant wrapper"). The invocation is
  **disk-fallback** (no stdin), because stdin mode is Claude-Code-only
  (`src/cli/commands/statusline.ts:65` hardcodes `loadById("claude-code", …)`); disk-fallback
  already produces the `[aireceipts · <opencode label>]` line for the newest opencode session
  (`loadFromDisk`, `statusline.ts:73`).
- **R2 — state-file contract.** Write is **atomic** (temp file + rename, the repo's existing
  pattern per SPEC-0062 R4). Default path is `$XDG_RUNTIME_DIR/aireceipts/opencode-status.txt`
  when `XDG_RUNTIME_DIR` is set, else the OS temp dir; overridable via
  `AIRECEIPTS_OPENCODE_STATUS_FILE`. The file is a **cache of one line** (last-writer-wins,
  never a ledger). **Fail-safe:** a non-zero CLI exit, empty stdout, or write error leaves any
  previous file untouched and the hook returns cleanly — the plugin never overwrites a good
  line with a blank/fabricated one, and never throws into opencode's event loop (I2/I3
  honesty: silence over a wrong line).
- **R3 — one-paste consumer wiring.** Docs ship copy-paste snippets for the two common
  surfaces that read the file: tmux (`status-right` running `cat`/a tiny reader) and a
  shell/starship prompt segment. This is the kill-criterion mitigation (below): a file nobody
  reads is dead weight, so the consumer setup cost must be a single paste.
- **R4 — recipe + setup parity.** The `codex`-sibling opencode recipe in
  `src/setup/integrations.ts` (currently `.opencode/commands/receipt.md`, lines 102–128) gains
  the plugin file, the `tui.json` `plugin` entry, and the R3 wiring snippet, surfaced through
  `integrations`/`setup` output. `docs/guide/15-integrations.md` and a new
  `docs/statusline.md` section document it in the **same PR** (the SPEC-0043/0062 docs-parity
  rule). The docs state plainly: this is **not** an in-TUI footer render — it is a state file
  an external surface displays — and it reflects the **newest** opencode session (R-limitation
  in Non-goals).
- **R5 — tested pure helper (no drift).** The plugin's non-Bun logic — resolve the state-file
  path (env → `XDG_RUNTIME_DIR` → tmp), atomic write, and the fail-safe "don't overwrite on
  empty/failed output" rule — lives in an importable helper covered by vitest without an
  opencode runtime. The shipped plugin snippet is **generated from / asserted byte-equal to**
  that helper's source in a test, so the recipe can't drift from the tested logic (same
  discipline that gates the other integration snippets).
- **R6 — no new network, telemetry unchanged.** The plugin invokes the CLI and nothing else;
  the CLI already records `integration_surface_rendered` with the `statusline` enum
  (`statusline.ts:161`). No new telemetry event and no new network path ship with this spec
  (I1/I4; SPEC-0043 rule — schema changes only alongside the code that needs them). The plugin
  is offline-pure beyond the single local CLI spawn.

## Scenarios

- **Given** opencode with the plugin loaded and a priced opencode session, **When** the agent
  goes idle, **Then** `$XDG_RUNTIME_DIR/aireceipts/opencode-status.txt` contains one line,
  `[aireceipts · <opencode label>] $X.XX · …`, and a wired tmux/shell surface shows it.
- **Given** an unpriced opencode session, **When** the hook runs, **Then** the file holds the
  tokens-only line (no `$` bytes) — the CLI's existing I2 behavior, unchanged by the plugin.
- **Given** the `aireceipts` binary is absent / exits non-zero / prints nothing, **When** the
  hook runs, **Then** the prior file is left intact, no exception escapes into opencode, and
  the next successful idle repairs it.
- **Given** `AIRECEIPTS_OPENCODE_STATUS_FILE=/custom/path`, **When** the hook runs, **Then**
  the line is written there atomically (temp + rename).
- **Given** no external surface is wired to read the file, **When** the hook runs, **Then**
  the line is still written (the plugin's job) but nothing displays — documented, and the R3
  snippets exist precisely to close this gap.

## Non-goals

- **In-TUI native footer/statusline render.** Blocked on opencode `ui.statusLine`/`ui.footer`
  (#8619/#18969/#23539, open). Documented follow-on: drop the CLI line into that hook the
  moment it ships; until then the state file is the surface.
- **Setting the terminal title.** Unverified whether a server-side opencode plugin's `$`
  reaches the user's TTY (opencode's client/server split); not promised until proven. If
  verified later, it's an additive R, not a rewrite.
- **npm-publishing the plugin as a standalone package.** A release/packaging call (the
  maintainer's four buttons); v1 ships source + recipe. `tui.json` can also load a published
  package name later without changing the plugin logic.
- **Multi-session concurrency correctness.** Disk-fallback is newest-wins; with two concurrent
  opencode sessions the line reflects the most-recently-active, not necessarily "this" TUI. A
  session-scoped read needs opencode-path support in statusline stdin mode
  (`statusline.ts:65`), a separate spec. v1 documents the single-session assumption.
- **Codex parity.** Codex exposes no plugin or command-backed status-line surface (openai/codex
  #17827, open) — there is no viable mechanism to spec, so Codex is explicitly out of scope
  here.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R2 atomic write | helper given a line + target path | temp file created then renamed; final file = the line |
| R2 default path | `XDG_RUNTIME_DIR` set / unset | `$XDG_RUNTIME_DIR/aireceipts/…` / OS-tmp path |
| R2 env override | `AIRECEIPTS_OPENCODE_STATUS_FILE=…` | write goes to the override path |
| R2 fail-safe empty | helper given empty/whitespace output, prior file present | prior file unchanged, no throw |
| R2 fail-safe write error | target dir unwritable | no throw; prior file (if any) intact |
| R1 disk-fallback line | priced opencode session | line starts `[aireceipts · <opencode label>] `, has `$` |
| R1 unpriced I2 | unpriced opencode session | tokens-only line, zero `$` bytes |
| R5 snippet parity | shipped plugin snippet vs helper source | byte-equal (drift test fails otherwise) |
| R4 recipe present | `integrations`/`setup` opencode output | includes plugin + `tui.json` entry + R3 wiring |
| R6 no network | plugin logic path | no network call; only the local CLI spawn |

## Success criteria

- [ ] R1–R6 implemented: the plugin surfaces the CLI line on `session.idle` into an
      atomically-written, env-overridable, fail-safe state file; the pure helper is
      vitest-covered and the shipped snippet is asserted equal to it.
- [ ] `docs/statusline.md` opencode section + `docs/guide/15-integrations.md` + the
      `integrations`/`setup` opencode recipe updated in the same PR, stating plainly it is a
      state-file surface (not an in-TUI footer) reflecting the newest opencode session.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass unmasked (`echo $?`).

## Validation

*2026-07-09 — S1 self, S2 Codex (independent), S3 worth gate, S4 lint.*

- **S1 (self):** every rendered value is the CLI's existing honest output (I2 tokens-only
  when unpriced; no new fabricated `$`). But the self-audit missed the correctness hole S2
  found — the design assumed disk-fallback is opencode-scoped when it is not.
- **S2 (Codex) — findings, mostly accepted:**
  1. *Accepted (High, correctness — kills the premise).* Disk-fallback is **not**
     opencode-scoped: `loadFromDisk` (`statusline.ts:73`) takes `sessions[0]` from an unfiltered,
     globally recency-sorted `listSessions()` (`load.ts:11`). So "newest opencode session" is
     false — it renders the globally-newest agent's line, mislabeled. Correct scoping needs a
     **CLI change** (an `--agent opencode` filter, or opencode-path support in stdin mode past
     the `claude-code` hardcode at `statusline.ts:65`) — so "the CLI side is already done" is
     wrong. The plugin cannot fix this from opencode's side.
  2. *Accepted (worth — decisive).* Smaller non-feature fix: tmux/starship can invoke
     `aireceipts statusline </dev/null` **directly** on their own refresh — no plugin, no state
     file, no `session.idle` hook, no producer/consumer split. It has the *same* global-newest
     limitation, so the plugin buys nothing on correctness and only adds machinery.
  3. *Accepted.* "No network" was misleading — the spawned CLI records
     `integration_surface_rendered` (`statusline.ts:161`); reworded would be needed.
  4. *Accepted.* R5 (byte-equal shipped snippet vs helper) is machinery without user value and
     is incoherent once the plugin wrapper holds Bun/event code the pure helper lacks.
  5. *Accepted.* Scope creep — state-file API + atomic writer + env contract + generated-source
     + two prompt integrations + three doc surfaces far exceed "surface the line."
  6. *Confirmed true & useful:* opencode parsing does exist (`src/parse/opencode.ts:462`), so a
     line *can* render — but per finding 1 it isn't reliably the opencode one.
- **S3 — worth answers.** *Who/how often:* the cohort is opencode ∩ aireceipts ∩ tmux/starship
  ∩ willing-to-configure-both-a-plugin-and-a-consumer — unmeasured, and telemetry can't correlate
  statusline renders to agent source (I4 has no repo/agent-attribution dim). *One-off vs
  recurring:* recurring in principle, but the surface is out-of-band (tmux/shell), not opencode's
  own footer, so it isn't the "same status line" the request imagined. *Do-nothing:* fine —
  opencode receipts already work; `aireceipts statusline </dev/null` already prints a line today.
  *Smaller fix:* a **doc snippet** (tmux `status-right` / starship command running the CLI
  directly) delivers ~80% with zero code. *Steelman the cut:* a plugin that requires configuring
  a producer *and* a separate consumer doubles setup for a line that still shows the wrong session
  and renders outside opencode — the doc dominates it. *Kill-criterion dry-run:* no evidence of
  demand; cheapest experiment is shipping the doc and seeing if anyone asks for in-TUI.

  **Verdict: cut.** The plugin as drafted is parked. The genuinely worth-building residue is a
  separate, smaller spec: an **opencode-scoped statusline** (`--agent <label>` filter or a
  session-path input) so *any* surface — tmux today, opencode's `ui.statusLine` when it ships —
  can show the *correct* opencode session. That's a CLI capability with lasting value; this
  plugin is not.
- **S4:** `node scripts/spec-lint.mjs` — pass.

## Tombstone

*Rejected 2026-07-09 (S3: cut).* **Tried:** an opencode plugin hooking `session.idle` to run
`aireceipts statusline` and write the line to an atomically-written state file for an external
tmux/shell surface to display — the "doable-now" path, since opencode has no native
`ui.statusLine`/`ui.footer` hook yet (#8619/#18969/#23539).

**Why rejected:** (1) *Correctness* — disk-fallback renders the globally-newest session, not the
opencode one (`statusline.ts:73` + `load.ts:11`), so the plugin surfaces a possibly-mislabeled
line and cannot fix that without a CLI-side scoping flag. (2) *Worth* — a doc snippet
(`aireceipts statusline </dev/null` in `tmux status-right` or a starship command) delivers the
same out-of-band line today with zero code; the plugin only adds a producer/consumer split that
likely deters adoption.

**What would change the answer:** opencode ships a native command-backed `ui.statusLine`/`ui.footer`
hook (then aireceipts drops the line into the real footer, in-band, and a thin plugin is
justified) — *and/or* a small separate spec adds opencode-scoping to `statusline` so the line is
provably the opencode session. Absent both, the honest interim is the doc, not this plugin.
