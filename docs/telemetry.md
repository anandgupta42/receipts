# Diagnostics telemetry

`aireceipts` can send small, anonymous, content-free diagnostics events to help us find bugs and understand which agent formats and CLI paths are actually used in the wild. This document is the full, authoritative description of what is sent, when, and how to turn it off. If anything here ever disagrees with the code in `src/telemetry/`, that's a bug — please file an issue.

## tl;dr

- **On by default**, but every event is one of exactly three fixed-shape records — never transcript content, prompts, file paths, repo names, hostnames, usernames, session IDs, dollar amounts, or raw model strings.
- **Disable anytime**: `AIRECEIPTS_TELEMETRY=off` (or `0`/`false`) or `DO_NOT_TRACK=1`. Either one results in **zero network calls** — not "send less," zero.
- **Inspect before you decide**: `aireceipts --telemetry-show` prints exactly what the current run would send, and sends nothing.
- **Bounded and fail-safe**: sending is capped at 300ms and can never throw, hang the CLI, or change its exit code. A slow or failed network call is simply abandoned.
- **First-run notice**: the very first time you run `aireceipts`, it prints a one-line disclosure pointing here. It never prints again after that.

## What is sent

There are exactly three event types. Nothing else is ever recorded.

### `cli_run` — one per CLI invocation

| Field | Type | Values | Notes |
|---|---|---|---|
| `cliVersion` | string | semver, e.g. `"0.3.1"` | From this package's own `package.json`. |
| `os` | enum | `darwin` \| `linux` \| `win32` \| `other` | `process.platform`, collapsed to a closed set — never the raw platform string. |
| `nodeMajor` | integer | e.g. `22` | Major Node version only. |
| `commandClass` | enum | `receipt` \| `compare` \| `handoff` \| `other` | Which subcommand ran — never the raw argv or any flag values. |
| `agentType` | enum | `claude-code` \| `codex` \| `cursor` \| `gemini` \| `opencode` \| `unknown` | Which agent format was parsed, if known. |
| `durationBucket` | enum | `<100ms` \| `100-500ms` \| `500ms-2s` \| `2-10s` \| `>10s` | Coarse bucket — never the raw millisecond count. |
| `ok` | boolean | | Whether the run succeeded. |
| `handoffFormat` | enum (optional) | `text` \| `json` | SPEC-0042: emission mode, present only on handoff-command runs — never content. |

### `cli_error` — one per uncaught error at the CLI's top level

| Field | Type | Values | Notes |
|---|---|---|---|
| `errorClass` | enum | `parse_error` \| `io_error` \| `network_error` \| `validation_error` \| `unknown_error` | A small fixed taxonomy derived from the error's constructor name or a well-known Node error code — **never `error.message`**, which can contain a file path or other identifying text. |
| `command` | enum | `receipt` \| `compare` \| `handoff` \| `other` | Same closed taxonomy as `cli_run.commandClass`. |
| `agentType` | enum | `claude-code` \| `codex` \| `cursor` \| `gemini` \| `opencode` \| `unknown` | |
| `inPackage` | boolean | | Whether the error's top stack frame originated inside `aireceipts`'s own installed code (helps us tell "our bug" from "your environment") — the stack trace text itself is inspected internally and never leaves the process. |

### `parse_failure` — one per transcript-parsing failure

| Field | Type | Values | Notes |
|---|---|---|---|
| `agentType` | enum | `claude-code` \| `codex` \| `cursor` \| `gemini` \| `opencode` \| `unknown` | |
| `adapterVersion` | string | short opaque token, e.g. `"1"` | An internal per-adapter constant, not anything read from a transcript. |
| `signatureHash` | string | 64-character sha256 hex digest | A hash of a content-free description of *where* parsing broke (e.g. `"claude-code:turn.usage.missing"`). The raw description is hashed before it ever reaches a payload — you cannot recover it from the hash, and it never contains transcript content. |

Every field above is validated against a `zod` schema in `.strict()` mode before it's ever queued (`src/telemetry/schemas.ts`). `.strict()` rejects any payload carrying an extra, unlisted key, so a bug elsewhere in the codebase cannot silently smuggle a new field (a path, a prompt, a dollar amount) into a payload — it would have to be added here, deliberately, and reviewed.

## What is never sent

Permanently, structurally banned — there is no field for any of these anywhere in the schema, and adding one would require an explicit, reviewed change to this document and to `src/telemetry/schemas.ts`:

- Transcript content or any excerpt of it
- Prompts or any user/assistant message text
- File paths (yours or the CLI's own, beyond the fixed `inPackage` boolean)
- Repo names or URLs
- Hostnames
- Usernames
- Session IDs
- Dollar amounts or any cost/pricing data
- Raw model strings (only the coarse `agentType` enum is sent)

## Kill switches

Either of the following disables telemetry completely. When disabled, `flushTelemetry()` returns immediately without making any network call — this is verified by tests that stub the network layer and assert it is never invoked.

```bash
AIRECEIPTS_TELEMETRY=off aireceipts ...
# or: AIRECEIPTS_TELEMETRY=0 / AIRECEIPTS_TELEMETRY=false (case-insensitive)

DO_NOT_TRACK=1 aireceipts ...
```

To disable permanently, export one of these in your shell profile.

## Inspecting what would be sent

```bash
aireceipts --telemetry-show
```

This prints whether telemetry is currently enabled and the exact events queued for the current run — the same objects that would be sent — without sending anything.

## How sending works

- Events are queued in-process as they occur and sent as a single batched request at CLI shutdown.
- The send is bounded to **300ms** via `Promise.race` against a timeout. If the network call is slow or hangs, it is abandoned in place; the CLI does not wait for it, and nothing is retried in the background.
- Every failure mode — telemetry disabled, an invalid event, a network error, a timeout — is swallowed inside the telemetry module. Telemetry can never throw, never block the CLI, and never change its exit code.
- The transport is Azure Application Insights, reached via a connection string (`InstrumentationKey=...;IngestionEndpoint=https://.../`) POSTed to `<ingestionEndpoint>/v2/track`.

## Connection-string honesty

This section exists so the code and this document can never quietly disagree.

- The ingestion key this package ships with is **not a secret** — Application Insights instrumentation keys are write-only and are commonly embedded in open-source clients. The shipped key, plainly: `InstrumentationKey=394da360-a50c-4700-bcf9-87b8d9d6e0ee` (ingestion endpoint `eastus-8.in.applicationinsights.azure.com`).
- **Current status**: a real Azure Application Insights resource is wired up as of 2026-07-02, so the diagnostics events documented above are sent by default (subject to the kill switches and the 300 ms bounded flush). Run `aireceipts --telemetry-show` to see exactly what a run would send before it sends anything.
- `AIRECEIPTS_TELEMETRY_CONNECTION` overrides the shipped default. Set it to point at your own Application Insights resource (e.g. for local development or a private fork), or set it to an empty string to force-disable telemetry independent of the kill switches.
- A malformed connection string (missing either `InstrumentationKey` or `IngestionEndpoint`) also degrades to `enabled: false` rather than sending to an incomplete endpoint.

## First-run notice

The first time `aireceipts` runs for a given user, it prints a one-line disclosure (pointing here) before doing anything else, then persists that fact to `~/.aireceipts/telemetry.json` so it never prints again. If that file can't be read or written (no home directory, read-only filesystem), the notice is simply shown again on the next run rather than the CLI failing.

## Source of truth

The schemas in `src/telemetry/schemas.ts` are the actual source of truth; this document is kept in sync with them by hand and reviewed alongside any change to that file. If you find a discrepancy, please open an issue.
