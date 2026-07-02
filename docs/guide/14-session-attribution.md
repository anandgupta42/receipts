# How session attribution works

A receipt is only as trustworthy as its answer to one question: *which session is
this?* This page explains what aireceipts treats as a session, how it finds them,
and why one can occasionally look split, merged, or missing.

## What a session is

A **session is one transcript file** your agent wrote — and its turns are the
events inside that file. aireceipts prices each turn and rolls them up. Where the
file lives depends on the agent:

| Agent | Where a session lives |
|---|---|
| Claude Code | `~/.claude/projects/<encoded-cwd>/<id>.jsonl` |
| Codex | `~/.codex/sessions/rollout-*.jsonl` |
| opencode | a session's rows in `~/.local/share/opencode` (SQLite) |
| Cursor | `~/Library/Application Support/Cursor/.../state.vscdb` |

It reads whatever each agent already writes — it never creates, moves, or rewrites
a transcript.

## How the newest is chosen

With no selector, aireceipts prices your **most-recently-ended** session across all
agents. Sessions are ordered by end time (falling back to start time), which is
also the order `--list` shows. A session with no recorded end time still lists and
prices, but it's never *guessed* into a time window — which matters for
[`week`](06-week.md) and [budgets](08-budget.md), where an end time is required to
bucket a session into the current or prior window.

## Subagents roll up into their parent

When a Claude Code session spawns subagents, each one writes its own child
transcript (`agent-<id>.jsonl`, under a `subagents/` folder beside the parent).
aireceipts treats those as **part of the parent session, not standalone sessions**:
they're excluded from `--list`, and their cost rolls up into the parent's receipt
(this is what the `SUBAGENTS` section of a [PR receipt](11-share-and-export.md#as-a-pr-comment-pr)
sums). So if you launched subagents and expected to see them listed separately —
that's by design; look at the parent.

## Projects (`--by-project`)

`week --by-project` groups sessions by the working directory they ran in. Claude
Code encodes the directory into the path segment under `projects/`; aireceipts
decodes it and keeps the last component (`-Users-dev-signup-form` → `form`). The
scheme is deliberately lossy — a real `-` in a folder name is indistinguishable
from an encoded `/` — which is exactly why it's behind an opt-in flag. Any session
without that segment (Codex, Cursor, or an unrecognized layout) buckets under
`(unknown)` rather than a fabricated project name.

## Why a session can look off

- **Cursor shows totals only.** Cursor's transcript carries no per-turn model,
  usage, or cache data, so its receipt is a session-level total in a labeled
  degraded mode. aireceipts never synthesizes the missing per-turn detail.
- **A session is missing from `week`.** It ended outside the trailing-7-day window,
  or has no end time. Pin the span with `--since` to check.
- **A session is missing entirely.** The file may be unreadable (wrong owner or
  mode); aireceipts skips such files silently rather than erroring. See
  [Troubleshooting](12-troubleshooting.md#no-agent-session-data-detected).
- **The wrong session matched.** A title-substring selector matched a different
  session than you meant. Run `--list` and select by its 1-based index instead.

## Next

- **[How pricing is estimated](13-pricing.md)** — from the session's tokens to dollars.
- **[Read a receipt](04-read-a-receipt.md)** — pick and read any one of them.
