# SPEC-0014 R1 spike — subscription quota context

**Blocking prerequisite for R2.** This documents what was checked on a real, currently
installed Claude Code (`2.1.198`) on this machine, per SPEC-0014 R1: "verify, on a real
local Claude Code install, whether any locally-readable surface... exposes rate-limit or
quota-window data."

## Result

**Surface clears — statusline stdin only.** No qualifying standalone on-disk state file
exists. R2 is implemented for stdin mode; standalone/disk mode is the documented R4
unavailable case (nothing printed, exit 0) — not a spec failure, per the spec's own kill
criterion.

## What was checked

### 1. Claude Code's `statusLine` stdin payload (clears)

Source: the official Claude Code docs, `https://code.claude.com/docs/en/statusline`
(fetched in full and read; this is the authoritative first-party spec for the mechanism,
not a third-party inference).

Claude Code, when a user configures a `statusLine` command in `settings.json`
(`{"statusLine": {"type": "command", "command": "..."}}`), invokes that command and pipes
a JSON payload to it on stdin after each new assistant message, after `/compact`, on
permission-mode change, and on vim-mode toggle. The documented full JSON schema includes:

```jsonc
{
  // ...cwd, session_id, model, workspace, cost, context_window, etc...
  "rate_limits": {
    "five_hour": { "used_percentage": 23.5, "resets_at": 1738425600 },
    "seven_day": { "used_percentage": 41.2, "resets_at": 1738857600 }
  }
}
```

Documented field semantics (verbatim from the docs table):

- `rate_limits.five_hour.used_percentage` / `rate_limits.seven_day.used_percentage` —
  "Percentage of the 5-hour or 7-day rate limit consumed, from 0 to 100."
- `rate_limits.five_hour.resets_at` / `rate_limits.seven_day.resets_at` — "Unix epoch
  seconds when the 5-hour or 7-day rate limit window resets."

This is exactly the *current-window state* SPEC-0014's purpose describes ("your 5h window
is at N%") — not a per-session delta, confirming the spec's S2 correction was right to
gate v1 on current-window state only.

Documented caveats (also verbatim, load-bearing for R4's unavailable/malformed handling):

- `rate_limits` **appears only for Claude.ai subscribers (Pro/Max)**, not API-key users.
- It appears **only after the first API response in the session** — absent on a
  freshly-started session before any turn completes.
- **Each window is independently optional** — `five_hour` may be present while
  `seven_day` is absent, or vice versa. The docs' own recommended safe-access pattern is
  `jq -r '.rate_limits.five_hour.used_percentage // empty'` (i.e. treat a missing field as
  absence, never as zero).
- The docs page ships a dedicated, first-class "Rate limit usage" worked example
  (Bash/Python/Node.js snippets) built specifically around this field — this is not an
  undocumented or experimental corner of the schema; it's a supported, intended use case.

No live capture of a real payload was taken on this machine: this machine's
`~/.claude/settings.json` does not currently have a `statusLine` configured, and
temporarily adding one to capture a sample payload would mean editing this user's real,
global Claude Code settings — outside this task's scope (isolated to the
`aireceipts-spec0014` worktree) and not something to do without being asked. The official
docs page is treated as authoritative for the schema instead: it is first-party,
current, versioned documentation with a dedicated worked example for this exact field,
which is strong enough evidence for a feasibility spike without a live capture.

### 2. Standalone on-disk state file under `~/.claude` (does not clear)

Two candidate files on this machine were inspected directly (read-only):

- **`~/.claude/.credentials.json`** — contains `claudeAiOauth.rateLimitTier`, a string
  naming the subscription/rate-limit *tier* (e.g. plan name). This is not a usage
  percentage and carries no window-state data. **Ruled out.**
- **`~/.claude/stats-cache.json`** — contains `modelUsage.<model-id>.{inputTokens,
  outputTokens, cacheReadInputTokens, cacheCreationInputTokens, webSearchRequests,
  costUSD, contextWindow, maxOutputTokens}`, which is **cumulative lifetime** usage per
  model, not current-rate-limit-window usage. There is no 5-hour/7-day window concept in
  this file at all. **Ruled out.**
- `~/.claude/cache/changelog.md` was also grepped for `rate_limit`/`quota`/`statusline`
  keywords — it contains historical product-changelog prose describing the statusline
  schema's evolution over past releases, not itself a runtime data surface.
- `claude --help` was checked for a debug/dump flag that could print the statusline
  payload without configuring a live `statusLine` — `-d/--debug [filter]` and
  `--debug-file <path>` exist for general debug logging, but there is no dedicated
  "dump statusline JSON" flag.

No other candidate file is named anywhere in the official docs, and none was found during
this investigation. **Conclusion: no qualifying standalone state file exists on this
install.**

## R1 verdict, mapped to R2/R4

| Mode | Surface | R2/R4 outcome |
|---|---|---|
| Statusline stdin | `rate_limits.{five_hour,seven_day}.used_percentage` — clears | R2 implemented: renders `your <window> window is at N% (official, from Claude Code's local data)` per present, in-range window |
| Standalone/disk | No qualifying state file found | R4 unavailable case: `--quota` prints nothing, exits 0, when not fed a stdin payload (e.g. run interactively with no pipe) |

This satisfies the spec's kill criterion framing either way: the surface *does* clear for
one of the two modes SPEC-0014 anticipated, so this is not a full no-op close — but the
standalone-mode half of R1 is a documented, valid "unavailable" finding, not a gap to be
filled by inventing a state file that doesn't exist.
