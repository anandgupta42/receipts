---
id: SPEC-0051
title: "Demo sample receipt — `--demo` renders a bundled example so an empty machine still sees value"
status: shipped
milestone: M5
depends: [SPEC-0001, SPEC-0018, SPEC-0043]
---

# SPEC-0051: `--demo` — a bundled sample receipt for the empty machine

## Purpose

A first-time user who runs `aireceipts` on a machine with no agent transcripts sees
only *"no agent session data detected"* — nothing that shows what the tool does. `--demo`
renders a bundled example session through the **real** parse→price→render pipeline and
prints the receipt, so anyone sees a genuine receipt in one command. It is the tool
running on a real (bundled) transcript, not a canned string. Serves I1 (deterministic;
zero model calls and zero **product-path** network — the demo reads a local file; the
only network any run may make is the disclosed `cli_run` telemetry, which the parity
tests disable), I2/I5 (the demo's
stdout is byte-identical to a committed golden — no fabricated output, gated), and
SPEC-0043 (the run reports its feature usage like any command).

## Requirements

- **R1 — `aireceipts --demo` renders the bundled sample receipt.** It loads a bundled
  Claude Code transcript via `loadById` → `buildReceiptModel` → `renderReceipt` and
  writes `renderReceipt(model, { color }) + "\n"` to **stdout** (the trailing newline
  matches how `scripts/goldens.mts` writes the golden — without it stdout is one byte
  short); a short "this is a sample" banner (Design) goes to **stderr** so stdout stays a
  pure receipt. Exit 0. No session discovery, no product-path network, works with zero
  real sessions on disk. Colour follows the same rule as the default receipt (off under
  `NO_COLOR` or a non-TTY stdout).
- **R2 — The sample ships in the package and its output is golden-pinned.** The
  transcript ships at `data/demo/` and is a byte-identical copy of the source fixture the
  README hero already renders from
  (`test/fixtures/claude-code/clean-multi-tool-2-models.jsonl`). Packaging is updated in
  **both** places that gate it: `package.json` `files` **and** the exact
  `FILES_ALLOWLIST` / required-path checks in `scripts/preflight-release.mjs` (adding to
  only one of the two either rejects the tarball or ships a demo that can't find its
  asset). A test pins the two fixture copies equal (no drift), and pins `--demo` stdout
  (colour off) byte-identical to the existing golden
  `goldens/claude-code-clean-multi-tool-2-models.txt`. No new golden file: the demo *is*
  the README receipt, rendered live.
- **R3 — The empty-state message points to `--demo`.** `noSessionsMessage`
  (`src/cli/common/session.ts`) appends the Design pointer on both its branches
  ("no agent session data detected …" and "no sessions found"). JSON/`--list --json`
  empty paths are untouched (they must stay valid JSON — SPEC-0044 board fix).
- **R4 — The run reports its feature usage.** `"demo"` is added to `COMMAND_VALUES`
  (`src/telemetry/schemas.ts`); the existing `cli_run` path records `commandClass:
  "demo"` via `toCommandTelemetry` with no other telemetry change. Content-free as
  ever. `docs/telemetry.md` `commandClass` enum list updated to include `demo`.
- **R5 — Documented and discoverable.** The command carries a `help` entry (the
  `goldens/cli/help.txt` golden is updated deliberately); the README Usage table and
  `docs/guide/01-getting-started.md` name `--demo` as the "no sessions yet? see one now"
  path.

## Design (lead-authored)

**Command** — new file `src/cli/commands/demo.ts` exporting `command: CommandDef`
(name `"demo"`, `matches: (o) => o.demo`). **Priority must sit below `telemetry-show`
(170)** so that `--telemetry-show --demo` still takes the telemetry-preview path (which
`src/cli/index.ts` exempts from recording) and never records/flushes — and above every
session-selecting command so `--demo` short-circuits discovery. Build step: read the
current priority ladder and slot demo just under `telemetry-show` (e.g. 168), asserting
nothing else occupies the chosen value. New boolean flag `demo` in `src/cli/options.ts`
(parse `--demo`), default false.

**Asset resolution** — resolve `data/demo/clean-multi-tool-2-models.jsonl` relative to
`import.meta.url` with dev + bundled candidates, mirroring `src/pricing/priceTable.ts`'s
`defaultDataDir` walk (dev: repo `data/`; bundled: `data/` ships beside `dist/`).

**Banner (stderr), verbatim:**

```
demo · a sample session bundled with aireceipts — your own sessions render the same way.
run `aireceipts` (no flags) once your agent has written a transcript. method: aireceipts --methodology
```

**Empty-state pointer (R3), verbatim** — appended after the existing message, on its own
line:

```
No sessions yet? Run `aireceipts --demo` to see a sample receipt.
```

**Render** — `renderReceipt(model, { color })` where `color` is computed exactly as the
default receipt command computes it; stdout gets `renderReceipt(...)` with no banner, so
`--demo | cat` (non-TTY, colour off) equals the golden byte-for-byte.

## Scenarios

- **Given** a machine with no agent transcripts, **When** `aireceipts --demo` runs,
  **Then** a full receipt prints to stdout, the banner to stderr, exit 0.
- **Given** `NO_COLOR=1` and a piped stdout, **When** `--demo` runs, **Then** stdout is
  byte-identical to `goldens/claude-code-clean-multi-tool-2-models.txt`.
- **Given** the shipped `data/demo` transcript, **When** compared to the source fixture,
  **Then** the bytes are identical (drift guard).
- **Given** `--help --demo`, **Then** help wins (priority), matching existing precedence.
- **Given** `aireceipts` with no sessions and no `--demo`, **Then** the empty-state
  message now ends with the `--demo` pointer; `--list --json` still emits `[]`.

## Non-goals

- **A bespoke demo transcript.** Reusing the README-hero fixture keeps one source of
  truth and reuses its golden; inventing a second sample is drift surface for no gain.
- **A `demo` positional subcommand** (`aireceipts demo`). One surface — the `--demo`
  flag — is enough; a second selector is redundant.
- **Animations / multiple sample receipts / a tour.** One real receipt is the job.
- **Changing the default (no-session) exit code.** The bare `aireceipts` empty path
  still exits non-zero; only its message gains the pointer.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 renders | `run(ctx)` with fake ctx, no sessions | stdout non-empty receipt (`AIRECEIPTS`, a `$` row); exit 0; banner on stderr |
| R1 e2e | built `dist/cli.js --demo` in an empty sandbox HOME | exit 0; stdout has the receipt; stderr has the banner |
| R1 colour off | `NO_COLOR=1`, non-TTY stdout | stdout has no ANSI escapes |
| R2 golden parity | `--demo` stdout (colour off) | byte-identical to `goldens/claude-code-clean-multi-tool-2-models.txt` |
| R2 no drift | `data/demo/*.jsonl` vs `test/fixtures/claude-code/clean-multi-tool-2-models.jsonl` | byte-identical |
| R2 packaged | `package.json` files + `preflight-release.mjs` allowlist + tarball | `data/demo` present and accepted in the published file list |
| priority | `--telemetry-show --demo` | telemetry-preview path wins; nothing recorded/flushed |
| R3 pointer | `noSessionsMessage()` (both branches) | ends with the Design `--demo` pointer |
| R3 json intact | `--list --json` with no sessions | still `[]` on stdout, exit 0 |
| R4 enum | `COMMAND_VALUES` / `toCommandTelemetry("demo")` | includes `demo`; maps to `"demo"` |
| R4 docs | `docs/telemetry.md` | `commandClass` list includes `demo` |
| R5 help | `goldens/cli/help.txt` | contains the `--demo` usage line |
| R5 docs | README Usage table + `docs/guide/01-getting-started.md` | name `--demo` |

## Success criteria

- [x] `aireceipts --demo` prints the sample receipt on a machine with zero sessions;
      stdout equals the golden with colour off.
- [x] `data/demo` ships in the package and matches its source fixture byte-for-byte.
- [x] Empty-state message points to `--demo`; JSON empty paths unchanged.
- [x] `demo` is a telemetry command value; docs updated; help golden updated.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass unmasked
      (`echo $?`).

**Kill criterion:** if `--demo` stdout cannot be made byte-identical to the committed
golden across dev and the packaged bundle (e.g. asset resolution or colour differs), the
feature is cut rather than shipping a demo that drifts from the golden it claims to be —
a demo that lies about being real output is worse than no demo.

## Validation

**2026-07-05 · S1 (self):** every seam verified against the code: `loadById(source, path)`
loads a transcript from an arbitrary path (used exactly this way in `scripts/goldens.mts`
:50-56); `buildReceiptModel` (`src/receipt/model.ts:200`) + `renderReceipt(model, {color})`
are the same calls the golden generator uses, so colour-off output equals the committed
golden by construction; command discovery needs no shared-file edit (`src/cli/registry.ts`
globs `commands/`); the only shared-file touch is one enum line in `schemas.ts`, whose
`toCommandTelemetry` (`src/telemetry/helpers.ts:46`) then maps the command name with no
further change; asset resolution mirrors `priceTable.ts`'s dev/dist candidate walk.

**2026-07-05 · S2 (Codex, read-only): REWORK → applied.** Four catches, all accepted:
(1) BLOCKER — golden is `renderReceipt(...) + "\n"`; R1 now writes the trailing newline
or stdout is one byte short. (2) BLOCKER — packaging needs `preflight-release.mjs`'s
`FILES_ALLOWLIST`, not just `package.json`; R2 updated. (3) HIGH — priority 178 outranked
`telemetry-show` (170), which would let `--telemetry-show --demo` record/flush; Design now
mandates a priority below 170 with a co-occurrence test. (4) MEDIUM — "zero network"
reworded to "zero product-path network"; parity tests disable telemetry. Non-blocking
confirmations: dev/dist price resolution consistent, `COMMAND_VALUES` + command name
suffices for `cli_run`, `parseOptions` still needs the `demo` flag (already in R-set).

**2026-07-05 · approved (button 1):** maintainer, in-session ("all of the above" →
"approved"). S3 value gate: this is the top launch-conversion fix from the strategy (a
first-run with no transcripts otherwise sees nothing); low surface, one flag + one shipped
asset. S2 waived-beyond-the-above under the solo-session directive; the build-time Codex
review covers the implementation.
