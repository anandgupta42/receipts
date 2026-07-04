# Platform spike — SPEC-0006 `SessionEnd` (R2, blocking, done before implementation)

**Question (R2):** Does Claude Code's `SessionEnd` hook event actually fire? What
is the payload shape? What is the exit/blocking behavior (R6)? Recorded against a
**real installed Claude Code**, not assumed.

## Environment tested

- Claude Code **2.1.198** (`claude --version`), macOS (darwin 24.6.0), Node ≥20.
- Method: an **isolated** `CLAUDE_CONFIG_DIR` (the documented config-dir override)
  pointing at a throwaway settings.json — the user's real `~/.claude` was never
  touched. A `SessionEnd` hook piped its stdin to a file; a one-shot headless
  `claude -p` session was run and then exited.

## Findings

### 1. `SessionEnd` fires — confirmed

It fired on session close even in headless (`-p`) mode. Choosing `SessionEnd`
over `Stop` is therefore proven, not assumed: `Stop` fires per assistant turn
(spammy), `SessionEnd` fires once when the session closes.

### 2. Observed payload shape (stdin JSON)

```json
{
  "session_id": "3a67c018-0919-479d-a103-beeb04364b44",
  "transcript_path": ".../projects/<slug>/3a67c018-...-.jsonl",
  "cwd": "/Users/anandgupta/codebase/aireceipts-spec0006",
  "prompt_id": "d29cdcd2-e7dd-4722-89ea-3315b66f1556",
  "hook_event_name": "SessionEnd",
  "reason": "other"
}
```

- `reason` observed as `"other"` here; Claude Code documents `clear`, `logout`,
  `prompt_input_exit`, `other`.
- `transcript_path` points at the just-ended session's JSONL. The installed
  command (`npx aireceipts-cli --mini`, no args) does **not** consume this payload —
  it renders the *newest* session, which at `SessionEnd` is the one that just
  ended. Reading `transcript_path` from stdin to target the exact session is a
  possible future refinement, out of scope for this spec's fixed command string.

### 3. Exit / blocking behavior (R6)

- **Hook exit code does not become Claude Code's exit code.** Four hook variants
  — `true` (exit 0), `exit 1`, a timeout-wrapped `exit 7`, and the real
  `aireceipts --mini` form — all left `claude`'s exit code identical (pinned at 1
  by the isolated dir's "Not logged in" state; constant across every hook
  variant). An earlier reading of "0 vs 1" was a **pipe-masking artifact**
  (`claude … | head` reports `head`'s exit, exactly the footgun AGENTS.md warns
  about) — corrected by redirecting to a file and checking `$?` unmasked.
- **A slow hook is cancelled by Claude Code, it does not hang the exit.** A
  `sleep 6` SessionEnd hook produced `SessionEnd hook [...] failed: Hook
  cancelled` and the process still exited — Claude Code bounds the hook itself.
- **SessionEnd hook stdout is not surfaced to the terminal in `-p`/headless
  mode** (the mini-receipt text was not echoed to `claude`'s stdout/stderr).
  Interactive-mode surfacing (transcript view) was **not** verifiable
  non-interactively — flagged as an open item, but it does not block the spec:
  the hook still renders correctly; where Claude Code displays SessionEnd stdout
  is Claude Code's behavior, not ours.

## Consequences for the implementation

- Target `hooks.SessionEnd` with the nested `…[].hooks[]` command shape (matches
  this repo's own `.claude/settings.json` and the user's real one).
- **R3/R6 reconciliation (flagged for the lead):** R3 quotes the entry as
  `{"matcher":"*","hooks":[{"type":"command","command":"npx aireceipts-cli --mini"}]}`
  with no wrapper, while R6 mandates a bounded invocation. A shell `timeout`
  wrapper is **not portable** to a clean macOS box (no `timeout` binary), which
  would silently break the hook. Resolution shipped: keep the exact command
  string `npx aireceipts-cli --mini` and add Claude Code's **native** per-hook
  `"timeout": 10` field (idiomatic — the user's real settings.json already uses
  `"timeout"` on a hook; the spike confirmed Claude Code enforces/cancels it).
  Belt-and-suspenders: `aireceipts --mini` is itself fail-safe (catches all,
  always exits 0), so it satisfies R6's error-swallowing regardless.
