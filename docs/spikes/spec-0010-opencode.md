# SPEC-0010 opencode adapter spike

Date: 2026-07-02

Verdict: viable. Implement a full adapter for current opencode SQLite storage,
with synthetic SQLite fixtures because the local default opencode DBs were empty
and the populated local opencode-format DBs contain private transcript content.

## Question

Does opencode expose stable local per-turn model ids, token usage, and tool-call
structure without calling a vendor API?

## Evidence Checked

- Local binary: `opencode` was not installed on `PATH`.
- Default data directory checked: `/Users/anandgupta/.local/share/opencode`.
  - DB files present: `opencode-local.db`, `opencode-upstream-merge-v1.17.9.db`.
  - Both expose the current SQLite tables (`session`, `message`, `part`, plus
    supporting project/account tables), but both had zero visible sessions.
- Populated local opencode-format evidence:
  - `/Users/anandgupta/.local/share/altimate-code/opencode-local.db`
    contained 1,887 sessions, 18,396 messages, and 70,749 parts.
  - `/Users/anandgupta/.local/share/altimate-code/opencode-upstream-merge-v1.17.9.db`
    contained 165 sessions, 767 messages, and 2,394 parts.
  - `session.version` rows in the second DB were versioned as
    `0.0.0-upstream/merge-v1.17.9-<timestamp>`.
- Schema evidence from both opencode data dirs:
  - `session` has aggregate token columns: `tokens_input`,
    `tokens_output`, `tokens_reasoning`, `tokens_cache_read`,
    `tokens_cache_write`, plus `model`, `time_created`, and `time_updated`.
  - Empty default opencode DBs also had `session_message`, which stores
    typed user/assistant rows with ordered `seq`, timestamps, and JSON `data`.
  - `message.data` assistant rows expose `modelID`, `providerID`, `tokens`,
    `cost`, and `time`.
  - `part.data` tool rows expose `type = "tool"`, `tool`, `state.status`,
    `state.input`, `state.output`, and `state.time.start/end`.
- Structural token-key checks on populated DBs:
  - `message.data.tokens` keys: `input`, `output`, `reasoning`, `cache`,
    and sometimes `total`.
  - `message.data.tokens.cache` keys: `read`, `write`.
  - Assistant messages with token payloads also had `modelID` and
    `providerID`.

## Interpretation

opencode passes the R1 viability bar for current SQLite storage:

- Per-turn model id exists on assistant messages (`message.data.modelID`).
- Per-turn token usage exists on assistant messages (`message.data.tokens`).
- Tool-call structure exists either in `session_message.data.content` or in
  `part.data` linked to assistant messages by `message_id`, with real timing.
- Session-level totals exist, but the adapter does not rely on them for priced
  attribution because per-message usage is available.

The populated DBs were not copied into the repo because they contain private
transcript content. This PR uses synthetic SQLite fixtures that preserve the
observed schema and token/tool shapes.

## Adapter Contract Landed

- Source id: `opencode`.
- Discovery root: opencode XDG data directory, with `OPENCODE_DATA_DIR`,
  `OPENCODE_DB_PATH`, and `OPENCODE_DB` overrides for tests/local installs.
- SQLite reader: reuses `src/parse/sqlite.ts`; supports the
  `session_message` schema and the populated `message`/`part` schema.
- Usage mapping:
  - `tokens.input` -> `TokenUsage.input`.
  - `tokens.output + tokens.reasoning` -> `TokenUsage.output`, because
    aireceipts has no separate reasoning bucket and dropping reasoning would
    under-report spend.
  - `tokens.cache.read` -> `cacheRead`.
  - `tokens.cache.write` -> `cacheCreation`.
  - cache TTL split fields stay absent because opencode does not expose them.
- Vendor mapping: each turn resolves by model id first, then source fallback.
  `claude-*` prices from `anthropic.json`, `gpt-*` from `openai.json`, and
  unknown/routed ids stay unpriced per I2.
