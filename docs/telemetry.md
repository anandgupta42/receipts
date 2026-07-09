# Diagnostics and adoption telemetry

`aireceipts` can send small, content-free telemetry events to help us find bugs and understand which CLI features are actually used. This document is the full, authoritative description of what is sent, when, and how to turn it off. If anything here disagrees with `src/telemetry/`, that is a bug.

## tl;dr

- **On by default**, but every event is one of a fixed nine-event catalog: `cli_run`, `cli_error`, `parse_failure`, `receipt_generated`, `export_generated`, `pr_flow_completed`, `hook_configured`, `integration_surface_rendered`, `activation_milestone`.
- **Never sent**: transcript content, prompts, file paths, repo names, hostnames, usernames, session IDs, dollar amounts, raw model strings, raw counts, or raw timestamps.
- **Pseudonymous install identity**: when telemetry is enabled, a random install id is stored locally and sent only as a salted sha256 hash so events from the same install can be counted over time. Delete `~/.aireceipts/state.json` to reset it.
- **Disable anytime**: `AIRECEIPTS_TELEMETRY=off` (or `0`/`false`) or `DO_NOT_TRACK=1`. Either one results in **zero network calls** and prevents install-id creation on a fresh install.
- **On by default in CI too**: `CI`/`GITHUB_ACTIONS` environments are treated the same as any other — telemetry is enabled by default there. Use a kill switch (`AIRECEIPTS_TELEMETRY=off` or `DO_NOT_TRACK=1`) to disable it in CI. (Before v0.7.0 it defaulted off in CI; reversed — see SPEC-0002.)
- **Inspect before you decide**: `aireceipts --telemetry-show` prints exactly what the current run would send, and sends nothing.
- **Bounded and fail-safe**: sending is capped at 300ms and can never throw, hang the CLI, or change its exit code.

## Event catalog

Every field below is validated against a `.strict()` zod schema before it is queued. Extra keys are rejected, so a bug elsewhere cannot smuggle a new field into a payload.

### `cli_run` — one per normal CLI invocation

| Field | Type | Values | Notes |
|---|---|---|---|
| `cliVersion` | string | semver | From this package's `package.json`. |
| `os` | enum | `darwin` \| `linux` \| `win32` \| `other` | Collapsed from `process.platform`. |
| `nodeMajor` | integer | e.g. `22` | Major Node version only. |
| `commandClass` | enum | `backfill` \| `benchmark` \| `check-budget` \| `compare` \| `demo` \| `handoff` \| `help` \| `install-hook` \| `list` \| `methodology` \| `mini` \| `pr` \| `quota` \| `receipt` \| `stats` \| `statusline` \| `telemetry-show` \| `templates` \| `uninstall-hook` \| `version` \| `week` | Selected command name only; never raw argv or flag values. |
| `agentType` | enum | `claude-code` \| `codex` \| `cursor` \| `gemini` \| `opencode` \| `unknown` | Which agent format was parsed, if known. |
| `durationBucket` | enum | `<100ms` \| `100-500ms` \| `500ms-2s` \| `2-10s` \| `>10s` | Coarse bucket; never raw milliseconds. |
| `ok` | boolean | | Whether the command returned exit code 0. |
| `isCI` | boolean | | True when `CI` or `GITHUB_ACTIONS` is set and not false. Telemetry is enabled by default in CI, so this field distinguishes CI runs from human runs in the data. |
| `installHash` | string | 64-hex sha256 or `unavailable` | Salted hash of the random local install id; raw id never leaves disk. |
| `runOrdinalBucket` | enum | `1` \| `2-3` \| `4-10` \| `11-50` \| `>50` \| `unavailable` | Lifetime run ordinal bucket; never the raw count. |
| `handoffFormat` | enum (optional) | `text` \| `json` | SPEC-0042: emission mode, present only on handoff-command runs — never content. |

### `cli_error` — one per uncaught top-level CLI error

| Field | Type | Values | Notes |
|---|---|---|---|
| `errorClass` | enum | `parse_error` \| `io_error` \| `network_error` \| `validation_error` \| `unknown_error` | Derived from bounded error metadata; never `error.message`. |
| `command` | enum | same command enum as `cli_run.commandClass` | Never raw argv. |
| `agentType` | enum | `claude-code` \| `codex` \| `cursor` \| `gemini` \| `opencode` \| `unknown` | |
| `inPackage` | boolean | | Whether the top stack frame is inside aireceipts; the stack text never leaves the process. |

### `parse_failure` — one per transcript parsing failure

| Field | Type | Values | Notes |
|---|---|---|---|
| `agentType` | enum | `claude-code` \| `codex` \| `cursor` \| `gemini` \| `opencode` \| `unknown` | |
| `adapterVersion` | string | short opaque token | Internal adapter version, not read from a transcript. |
| `signatureHash` | string | 64-hex sha256 | Hash of a content-free structural failure descriptor. |

### `receipt_generated` — one per rendered cost receipt

| Field | Type | Values | Notes |
|---|---|---|---|
| `surface` | enum | `receipt` \| `compare` \| `mini` \| `pr` | Statusline/quota/template previews are not receipts. |
| `agentType` | enum | `claude-code` \| `codex` \| `cursor` \| `gemini` \| `opencode` \| `unknown` | `unknown` for mixed-agent/multi-session surfaces. |
| `multiAgent` | boolean | | True when the rendered surface combines more than one session/model. |
| `outputMode` | enum | `text` \| `json` \| `csv` \| `svg` \| `png` \| `markdown` | |
| `template` | enum | `classic` \| `grocery` \| `datavis` \| `none` | `none` when no template flag drove the render. |
| `pricedRowCoverage` | enum | `none` \| `some` \| `all` | Share of rendered tool rows with resolved prices; no dollars are sent. |
| `hasStuckLoopWaste` | boolean | | |
| `hasTrivialSpansWaste` | boolean | | |
| `hasContextThrashWaste` | boolean | | |
| `hasPriceDelta` | boolean | | Whether the receipt had an arithmetic cheaper-model delta line. |
| `hasSubagents` | boolean | | Whether subagent (child) transcripts were folded into the receipt's totals (SPEC-0061). A boolean, never a count. |
| `hasPreEditShare` | boolean | | Whether the receipt rendered a pre-edit cost-share line (SPEC-0067). A boolean, never the percentage, counts, or `$`. |
| `detailsView` | boolean | | Whether the receipt rendered the opt-in `--details` section. |
| `turnCountBucket` | enum | `0` \| `1` \| `2-3` \| `4-10` \| `11-50` \| `>50` | Never raw turn count. |
| `toolCallCountBucket` | enum | `0` \| `1` \| `2-3` \| `4-10` \| `11-50` \| `>50` | Never raw tool-call count. |
| `receiptOrdinalBucket` | enum | `1` \| `2-3` \| `4-10` \| `11-50` \| `>50` \| `unavailable` | Lifetime local receipt ordinal bucket. |

### `export_generated` — one per successful export path

| Field | Type | Values | Notes |
|---|---|---|---|
| `surface` | enum | `receipt` \| `compare` \| `week` \| `list` \| `pr` \| `backfill` | |
| `format` | enum | `json` \| `csv_session` \| `csv_tool` \| `svg` \| `png` \| `markdown` \| `html` \| `text` | |
| `wroteFile` | boolean | | False for stdout exports. |
| `result` | enum | `success` \| `no_data` \| `invalid_args` \| `declined` \| `external_missing` \| `external_failed` \| `write_failed` \| `internal_error` | |

### `pr_flow_completed` — one per `aireceipts pr` flow

| Field | Type | Values | Notes |
|---|---|---|---|
| `mode` | enum | `dry_run` \| `post` | |
| `artifactRequested` | boolean | | |
| `shareRequested` | boolean | | |
| `contributorCountBucket` | enum | `0` \| `1` \| `2-3` \| `4-10` \| `11-50` \| `>50` | Never raw contributor count. |
| `commentResult` | enum | `success` \| `failed` \| `skipped` | |
| `artifactResult` | enum | `success` \| `failed` \| `skipped` | |
| `shareResult` | enum | `success` \| `failed` \| `skipped` | |
| `handoffSectionIncluded` | boolean | | SPEC-0059: the rendered body carried the handoff section (rendering rate only — never engagement, never contents). |
| `result` | enum | `success` \| `no_data` \| `invalid_args` \| `declined` \| `external_missing` \| `external_failed` \| `write_failed` \| `internal_error` | |

### `hook_configured` — one per hook install/uninstall command

| Field | Type | Values | Notes |
|---|---|---|---|
| `operation` | enum | `install` \| `uninstall` | |
| `promptOutcome` | enum | `accepted` \| `declined` \| `not_prompted` | |
| `result` | enum | `success` \| `no_data` \| `invalid_args` \| `declined` \| `external_missing` \| `external_failed` \| `write_failed` \| `internal_error` | |

### `integration_surface_rendered` — one per passive integration render

| Field | Type | Values | Notes |
|---|---|---|---|
| `integration` | enum | `statusline` \| `quota` | `mini` is a receipt, not an integration event. |
| `inputMode` | enum | `stdin_payload` \| `disk_fallback` \| `none` | |
| `payloadValid` | boolean | | Whether the stdin payload was usable for the integration. |
| `customFormat` | boolean (optional) | | statusline only (SPEC-0062): an explicit `--format` was passed. The boolean only — never the format string. |
| `scoped` | boolean (optional) | | statusline only (SPEC-0075 R6): `--cwd` was supplied. The boolean only — never the path. |
| `configFile` | boolean (optional) | | statusline only (SPEC-0075 R6): a valid `statusline.json` supplied the item order. The boolean only — never the items. |
| `result` | enum | `success` \| `no_data` \| `invalid_args` \| `declined` \| `external_missing` \| `external_failed` \| `write_failed` \| `internal_error` | |

`statusline --cwd` is a polled surface: it still advances the local run counter
and records these bounded booleans in-process, but that invocation skips the
network flush. A 15-second tmux poll therefore does not become a stream of
network events.

### `activation_milestone` — once per milestone per local state file

| Field | Type | Values | Notes |
|---|---|---|---|
| `milestone` | enum | `first_run` \| `first_receipt` \| `third_receipt` \| `tenth_receipt` \| `first_export` \| `first_compare` \| `first_week` \| `first_hook_install` \| `first_pr` \| `first_pr_post` \| `first_artifact` | |
| `command` | enum | same command enum as `cli_run.commandClass` | Command that caused the milestone. |
| `installAgeBucket` | enum | `first_day` \| `2-7d` \| `8-30d` \| `31-90d` \| `>90d` \| `unavailable` | Derived locally from `firstRunAt`; raw date is not sent. |

## Install identifier

On the first telemetry-enabled run, aireceipts creates a random UUID in `~/.aireceipts/state.json`. It is never derived from hostname, username, MAC address, machine id, repo, path, or transcript data. The wire payload carries only:

```text
sha256("aireceipts-install-v1:" + installId)
```

That hash intentionally links events from the same install over time so adoption and retention can be counted. It does not identify a person, machine, or repo. To reset it, delete `~/.aireceipts/state.json`. If `AIRECEIPTS_TELEMETRY=off` or `DO_NOT_TRACK=1` is active on a fresh install, no install id is created.

## Local counters

`~/.aireceipts/state.json` also stores local counters:

- `runCount`
- `receiptCount`
- `firstRunAt`
- once-only activation milestone booleans

These exact counts stay on your machine. The `aireceipts stats` command prints the local receipt/run counters and labels them "on this machine." Telemetry payloads use only buckets.

## What is never sent

Permanently, structurally banned:

- Transcript content or any excerpt of it
- Prompts or user/assistant message text
- File paths
- Repo names or URLs
- Hostnames
- Usernames
- Session IDs
- Dollar amounts or cost/pricing data
- Raw model strings
- Raw counts
- Raw timestamps

## Kill switches

Either of the following disables telemetry completely. When disabled, `flushTelemetry()` returns immediately without making any network call, and fresh installs do not create an install id.

```bash
AIRECEIPTS_TELEMETRY=off aireceipts ...
# or: AIRECEIPTS_TELEMETRY=0 / AIRECEIPTS_TELEMETRY=false (case-insensitive)

DO_NOT_TRACK=1 aireceipts ...
```

### CI behavior (on by default)

Telemetry is **enabled by default in CI**, the same as any other environment — `CI` and
`GITHUB_ACTIONS` are not special-cased. Automated CI runs are counted; the `isCI` field (above)
records whether a run was in CI so CI vs. human usage stays distinguishable in the data. To turn
telemetry **off** in a CI environment, use a kill switch:

```bash
AIRECEIPTS_TELEMETRY=off aireceipts ...   # or DO_NOT_TRACK=1 — disables telemetry in CI or anywhere
```

Precedence is: `AIRECEIPTS_TELEMETRY=off`/`DO_NOT_TRACK=1` (always win) → the connection-string
checks below. (Before v0.7.0, telemetry defaulted **off** in CI; that default was reversed — see
SPEC-0002's 2026-07-08 amendment.)

## Inspecting what would be sent

```bash
aireceipts --telemetry-show
```

This prints whether telemetry is currently enabled and the exact events queued for the current run without sending anything. The command itself records nothing and skips the flush.

## How sending works

- Events are queued in-process as they occur and sent as a single batched request at CLI shutdown.
- The send is bounded to **300ms**. If the network call is slow or hangs, it is abandoned; the CLI does not wait for it, and nothing is retried in the background.
- Every failure mode is swallowed inside the telemetry module. Telemetry can never throw, block the CLI, or change its exit code.
- The transport is Azure Application Insights, reached via a connection string (`InstrumentationKey=...;IngestionEndpoint=https://.../`) POSTed to `<ingestionEndpoint>/v2/track`.
- Like any HTTPS/App Insights request, the transport stamps an arrival time for the batch. The "no raw timestamps" rule covers payload fields chosen by aireceipts, not transport metadata created by the service.

## Connection-string honesty

- The ingestion key this package ships with is **not a secret**; Application Insights instrumentation keys are write-only and are commonly embedded in open-source clients. The shipped key: `InstrumentationKey=394da360-a50c-4700-bcf9-87b8d9d6e0ee` (ingestion endpoint `eastus-8.in.applicationinsights.azure.com`). <!-- gitleaks:allow -->
- `AIRECEIPTS_TELEMETRY_CONNECTION` overrides the shipped default. Set it to your own Application Insights resource or to an empty string to force-disable telemetry.
- A malformed connection string also degrades to `enabled: false` rather than sending to an incomplete endpoint.

## First-run notice

The first time `aireceipts` runs for a given user while telemetry is enabled, it prints a one-line disclosure pointing here, then persists `{ "shown": true }` to `~/.aireceipts/telemetry.json` so it never prints again. If `AIRECEIPTS_TELEMETRY=off` or `DO_NOT_TRACK=1` is active before that first enabled run, `aireceipts` prints no notice and does not persist the shown flag; the notice appears on the first later run where telemetry is enabled. If the notice file cannot be read or written, the notice is shown again on the next enabled run rather than failing the CLI.

## Source of truth

The schemas in `src/telemetry/schemas.ts` are the actual source of truth. This document is kept in sync with them and reviewed alongside any schema change.
