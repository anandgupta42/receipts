# Statusline — the meter

`aireceipts statusline` is the meter: one line in your status bar while the agent
works — the model that's running, cost so far, burn rate, and the quota countdown —
updated as the session runs. When the ride ends, `aireceipts` prints the receipt.
Wired into Claude Code's `statusLine` command config, the fare is visible on every
prompt without running anything yourself.

## Setup

Add a `statusLine` entry to your Claude Code `settings.json` (global:
`~/.claude/settings.json`, or project-local: `.claude/settings.json`):

```json
{
  "statusLine": {
    "type": "command",
    "command": "aireceipts statusline"
  }
}
```

Claude Code invokes this command on its own schedule and pipes a JSON payload
(including `transcript_path` for the active session) on stdin. `aireceipts`
reads that payload, loads the referenced transcript directly, and prints one
line — no polling, no background process, no daemon.

If `aireceipts` isn't on your `PATH`, use an absolute path to the binary
instead of `aireceipts` in the `command` field (for example, the output of
`which aireceipts`).

## Terminal surfaces

Pass a pane's working directory to `--cwd` and aireceipts shows that pane its
own session — any terminal surface that can run a command and display one line
of stdout works, which is how Codex and opencode sessions get a statusline.
These recipes call `aireceipts` directly: install it first
(`npm i -g aireceipts-cli`) — paying `npx` startup on every refresh is too slow
for a polled bar.

For tmux, add this to `~/.tmux.conf`:

```tmux
set -g status-right '#(aireceipts statusline --cwd "#{pane_current_path}")'
```

tmux refreshes `#(...)` commands on `status-interval`; lower that setting if you
want a fresher line, keeping in mind that each refresh runs the command again.

### Make the bar appear whenever you launch your agent

The tmux bar only exists inside tmux — a plain terminal tab has no status bar
to draw on. To get the bar automatically every time you run Codex or opencode
(without changing how the rest of your terminal behaves), wrap the command in
a shell function that starts tmux on demand. In `~/.zshrc` (or `~/.bashrc`):

```sh
_aireceipts_tmux_wrap() {
  local bin="$1"; shift
  if [ -n "$TMUX" ] || ! command -v tmux >/dev/null; then
    command "$bin" "$@"
  else
    tmux new-session -- "$bin" "$@"
  fi
}
codex()    { _aireceipts_tmux_wrap codex "$@"; }
opencode() { _aireceipts_tmux_wrap opencode "$@"; }
```

Running `codex` in any new tab now opens it inside a fresh tmux session with
the status bar live; when the agent exits, the session ends (tmux's default —
one window, `remain-on-exit` off) and you are back in your plain shell. Inside
an existing tmux session the wrapper steps aside and runs the command
directly. tmux auto-names each session, so concurrent launches never collide
or mirror each other. Multiple arguments are passed through to the program
verbatim (no shell re-parsing). If a TUI's colors or keys look
wrong inside the wrapper, set `set -g default-terminal "tmux-256color"` in
`~/.tmux.conf`. Claude Code needs no wrapper — its native `statusLine` hook
above renders inside the app itself.

**No tmux?** The wrapper deliberately falls back to running the agent
unwrapped (no bar, no error). Install tmux to get the live bar
(`brew install tmux` on macOS, `sudo apt install tmux` on Debian/Ubuntu) — or
use
any other surface that can run a command and show a line, per the contract
above. Without a multiplexer, the prompt and terminal-title recipes below
still work, with one honest limit: they refresh only between commands, so the
line sits stale while an agent owns the terminal. A live bar *outside* the
agent needs a host that reserves screen space for it — that is tmux's role
here (Claude Code's in-app status line is the agent-native exception).

### Matching rules

`--cwd` selects the newest session attributed to that path (or an ancestor of
it) and prints the neutral placeholder when none match — it never falls back to
another project's newest session. A session launched from your home directory
(or above it) only ever matches that exact path, so one `~`-launched session
can't shadow every pane on the machine. Relative `--cwd` paths resolve against
the directory where `aireceipts` is invoked; a path beginning with `-` must use
the `--cwd=<path>` form. Matching intentionally folds only a Windows drive
letter's case — the rest of every path remains case-sensitive, because
over-matching on a case-sensitive filesystem is the worse failure. Cursor is
excluded from scoped discovery entirely because its session data carries no
cwd.

Path matching is lexical rather than filesystem-canonical. If `$PWD` uses a
symlinked spelling while a session records the physical path, they do not
match. tmux's `#{pane_current_path}` is resolved, so the tmux recipe above is
unaffected.

<!-- SPEC-0075 R3b -->

tmux is the recommended live terminal surface because it keeps polling while a
command or agent owns the pane. The prompt and title recipes below refresh only
**between commands**: while an agent owns the terminal they sit stale, and the
cached line you see is one prompt behind. Each refresh is a per-prompt
fire-and-forget process that exits after its atomic cache write — there is no
resident daemon.

### Starship (zsh/bash)

Starship's default `command_timeout` is 500ms, below Node's roughly one-second
startup floor. This custom module therefore prints the last cwd-keyed cache and
starts the next refresh in the background. Add it to `~/.config/starship.toml`:

```toml
[custom.aireceipts]
command = '''
key=$(printf '%s' "$PWD" | shasum | cut -c1-12)
cache="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/aireceipts-statusline-$key"
[ -r "$cache" ] && cat "$cache"
(
  tmp="${cache}.$$.tmp"
  if aireceipts statusline --cwd "$PWD" >"$tmp" 2>/dev/null; then
    mv -f "$tmp" "$cache"
  else
    rm -f "$tmp"
  fi
) >/dev/null 2>&1 &
'''
when = true
shell = ["sh"]
format = "$output "
```

The hash keeps panes in different repositories from reading each other's line;
the temp-file-plus-`mv` keeps readers from seeing a partial line.

### Raw zsh or bash

Without a prompt engine, use the same cache-first pattern. For zsh, add this to
`~/.zshrc`:

```zsh
_aireceipts_precmd() {
  local key cache
  key=$(printf '%s' "$PWD" | shasum | cut -c1-12)
  cache="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/aireceipts-statusline-$key"
  [[ -r "$cache" ]] && command cat "$cache"
  (
    local tmp="${cache}.$$.tmp"
    if aireceipts statusline --cwd "$PWD" >"$tmp" 2>/dev/null; then
      mv -f "$tmp" "$cache"
    else
      rm -f "$tmp"
    fi
  ) >/dev/null 2>&1 &!
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd _aireceipts_precmd
```

For bash, add this to `~/.bashrc`:

```bash
_aireceipts_prompt_command() {
  local key cache
  key=$(printf '%s' "$PWD" | shasum | cut -c1-12)
  cache="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/aireceipts-statusline-$key"
  [[ -r "$cache" ]] && command cat "$cache"
  (
    local tmp="${cache}.$$.tmp"
    if aireceipts statusline --cwd "$PWD" >"$tmp" 2>/dev/null; then
      mv -f "$tmp" "$cache"
    else
      rm -f "$tmp"
    fi
  ) >/dev/null 2>&1 &
}
PROMPT_COMMAND="_aireceipts_prompt_command${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
```

### OSC terminal title

An OSC title is independent of the prompt engine and works in any OSC-capable
terminal emulator. This zsh `precmd` emits `ESC]0;<line>BEL`, then refreshes the
cwd-keyed cache for the next prompt:

```zsh
_aireceipts_title_precmd() {
  local key cache line
  key=$(printf '%s' "$PWD" | shasum | cut -c1-12)
  cache="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/aireceipts-statusline-$key"
  if [[ -r "$cache" ]]; then
    IFS= read -r line < "$cache"
    printf '\033]0;%s\007' "$line"
  fi
  (
    local tmp="${cache}.$$.tmp"
    if aireceipts statusline --cwd "$PWD" >"$tmp" 2>/dev/null; then
      mv -f "$tmp" "$cache"
    else
      rm -f "$tmp"
    fi
  ) >/dev/null 2>&1 &!
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd _aireceipts_title_precmd
```

### Windows PowerShell

Starship and Oh My Posh both work in PowerShell. Put this wrapper **after** the
prompt engine's initialization line in `$PROFILE`; it preserves that engine's
prompt, prints the last cwd-keyed line, and starts an atomic refresh job. Completed
jobs are removed on the next prompt, so the refresh never becomes a daemon.

```powershell
$global:AireceiptsBasePrompt = (Get-Command prompt).ScriptBlock
function global:prompt {
  $cwd = (Get-Location).Path
  $runtime = if ($env:XDG_RUNTIME_DIR) { $env:XDG_RUNTIME_DIR } elseif ($env:TEMP) { $env:TEMP } else { [IO.Path]::GetTempPath() }
  $bytes = [Text.Encoding]::UTF8.GetBytes($cwd)
  $key = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).Substring(0, 12).ToLowerInvariant()
  $cache = Join-Path $runtime "aireceipts-statusline-$key"

  Get-Job -Name "aireceipts-statusline-*" -State Completed -ErrorAction SilentlyContinue | Remove-Job
  if (Test-Path -LiteralPath $cache) {
    $line = Get-Content -LiteralPath $cache -Raw
    if ($line) { Write-Host -NoNewline "$($line.TrimEnd()) " }
  }

  Start-Job -Name "aireceipts-statusline-$key" -ArgumentList $cache, $cwd -ScriptBlock {
    param($cache, $cwd)
    $tmp = "$cache.$PID.tmp"
    $line = & aireceipts statusline --cwd $cwd 2>$null
    if ($LASTEXITCODE -eq 0) {
      [IO.File]::WriteAllText($tmp, ($line -join [Environment]::NewLine) + [Environment]::NewLine)
      Move-Item -LiteralPath $tmp -Destination $cache -Force
    } else {
      Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
  } | Out-Null

  & $global:AireceiptsBasePrompt
}
```

On Windows, the tmux recipe is WSL-only. Use the PowerShell pattern above for
native Starship or Oh My Posh sessions.

For Claude Code, its native `statusLine` stdin hook above remains the recommended
surface. It is faster because the payload points directly at the active
transcript, and it is richer: `context`, `quota5h`, `quota7d`, and `quotaEta`
depend on stdin data. Terminal surfaces are additive when you also want a line
in tmux or another shell UI.

## Output

```
[aireceipts] Opus · $4.20 · $9/hr · 128k · ctx 42% · 5h 24% ↺2h13m
[aireceipts] Opus · $2.50 · $6/hr · 20k · ⚠ Bash loop ×5 · 5h 41% ↺58m
[aireceipts · Codex] gpt-5.2-codex · $1.10 · $4/hr · 84k
[aireceipts · Cursor] 8k
aireceipts: no sessions detected
```

- `Opus` (after the brand) is the model — in stdin mode, Claude Code's own current
  model name (a mid-session switch shows on the next render); in disk fallback, the
  session's dominant model by token share. Omitted when neither is known.
- `$X.XX` is the session's priced cost (aireceipts' own cited-price figure, incl.
  subagents); omitted when it can't be priced — never a fabricated `$` amount.
- `$X/hr` is the session-average burn rate (that same priced cost over the session
  wall-clock); omitted when the session isn't priced or has no duration yet.
- `Nk` / `NM` is the session's token count, abbreviated (`12k`, `1.2M`, `501M`).
- `ctx N%` is how full the current context window is — Claude Code's own
  pre-calculated `context_window.used_percentage`, omitted when the payload lacks it.
- `5h N% ↺Xh Ym` is your official 5-hour rate-limit usage (Claude Code's own
  `rate_limits.five_hour.used_percentage`, subscribers only) plus the time until the
  window resets, derived from the real `resets_at` — the countdown is dropped (leaving
  `5h N%`) when `resets_at` is absent or already past, never a guessed time.
- The waste flag (`⚠ ...`) appears only when a waste detector actually fired
  on the session — its absence is not itself a claim that nothing was found.
- Outside a piped invocation (or when stdin carries no usable payload),
  `aireceipts statusline` falls back to the most-recently-ended session found
  on disk — the prefix then names whose session it is (`[aireceipts · Codex]`).
  If no sessions are detected at all, it prints the neutral placeholder line
  shown above rather than an error, so the statusline layout never breaks.

## Custom formats (`--format`)

The default line is the format `brand,model,cost,burn,tokens,context,waste,quota5h`. Pick your own
segments with `--format` (comma-separated; a segment with nothing honest to say
is omitted, and an unknown name exits 1 with the valid list on stderr):

```json
{
  "statusLine": {
    "type": "command",
    "command": "aireceipts statusline --format brand,cost,quota5h,quotaEta"
  }
}
```

For a persistent format shared by every statusline surface, create
`~/.aireceipts/statusline.json` (under `AIRECEIPTS_HOME` when set):

```json
{
  "items": ["brand", "cost", "tokens", "quota5h"]
}
```

The array uses the same vocabulary and literal ordering as `--format`, including
duplicate items. Precedence is explicit `--format`, then `statusline.json`, then
the default above. A missing file is silent. An unreadable file, bad JSON, wrong
shape, empty `items`, or unknown item prints one stderr note and safely renders
the default; a broken dotfile never blanks a polling status bar. Config can only
select known segments — it cannot inject text, colors, paths, or values.

| Segment | Renders | Source |
|---|---|---|
| `brand` | `[aireceipts]` (stdin) / `[aireceipts · <agent>]` (disk fallback) | — |
| `model` | `Opus` / `claude-opus-4-8` | stdin: Claude Code's own `model.display_name` (the **current** model, so a mid-session switch shows on the next render); disk fallback: the session's dominant model by token share (the mini receipt's value); omitted when neither exists (e.g. Cursor). Guarded: trimmed, ≤ 64 chars, no control characters. |
| `cost` | `$X.XX` | priced session total incl. subagents; omitted when unpriced (I2) |
| `burn` | `$X/hr` | session-average burn (priced cost ÷ wall-clock); omitted when unpriced or no duration |
| `tokens` | `Nk` / `NM` | session + subagent tokens, abbreviated |
| `context` | `ctx N%` | Claude Code's `context_window.used_percentage` (stdin only) |
| `waste` | `⚠ ...` | first fired waste detector |
| `quota5h` / `quota7d` | `5h N% ↺Xh Ym` / `7d N% ↺…` | official `rate_limits` passthrough + reset countdown (stdin only) |
| `quotaEta` | `≈ 5h cap HH:MM UTC` | labeled arithmetic, see below |

### `quotaEta` honesty rules

The ETA is straight-line arithmetic between exactly two observed readings of
your 5h window (the previous invocation's, cached in
`~/.aireceipts/quota-window.json`, and this one's) — the `≈` label is
mandatory, and the segment renders **only** when every guard holds: same window
(unchanged `resets_at`), rising usage, readings at least 60s apart, no
clock-skew between them, and the projected crossing landing before the window
resets. Anything ambiguous renders nothing — an omitted segment, never a
guessed time. It is an extrapolation of your recent burn rate, not a
prediction of what you'll do next.

## Notes

- One line, one on-disk read per invocation — this is a snapshot, not a live
  view. Nothing streams mid-session (see the CLI's non-goals).
- Sessions that can't be priced (missing price rows) render tokens-only —
  `aireceipts` never estimates a dollar figure it can't source to a price row.
- Subagent spend is included (SPEC-0061): background agents write their
  transcripts to separate files under the session's `subagents/` directory,
  and the statusline's `$` and token counts fold that rollup in — the same
  aggregate the session receipt draws as its `SUBAGENTS (N)` row.

## Known limitation: refresh cadence

Claude Code re-invokes the statusline command only when the main conversation
updates. During a long stretch of background-agent work with the main loop
idle, the line is not re-invoked and can sit stale until the next
main-conversation event — that is host behavior, not a rendering bug: every
invocation reads the transcripts fresh.
