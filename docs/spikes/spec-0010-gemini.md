# Platform spike — SPEC-0010 Gemini CLI adapter (R1, blocking, done before parser code)

**Question (R1):** Does Gemini CLI persist a stable, local, per-turn transcript
that exposes **per-turn model id AND per-turn token usage** — enough for a
full-fidelity (R3) adapter — or only totals (degrade to R4)? Recorded against
the vendor's real source and docs, not assumed.

## Verdict

**Full-fidelity (R3) is viable.** Gemini CLI's `ChatRecordingService` writes an
append-only JSONL transcript per session that records, on every model turn: the
model id, a complete `TokensSummary` (prompt / candidates / cached / thoughts /
tool-use / total), and the turn's tool calls. That is strictly more than the R1
bar, so Gemini CLI lands as a **priced** adapter (like Claude Code / Codex), not
a degraded tokens-only one (unlike Cursor).

## Environment / evidence

- **No local `~/.gemini` install exists on the build machine** (`~/.gemini`
  absent), so the format was pinned from the vendor's **Apache-2.0 source** and
  official docs rather than a live capture. Fixtures are therefore **synthetic,
  encoded verbatim against the source schema below** — a deliberate, disclosed
  deviation from the skill's "real fixtures" bar, forced by the absence of an
  install and directed by the task's context law (build fixtures from format
  docs; never pull real transcripts into context). When a real install is
  available, R5 fixtures should be re-captured and the goldens re-blessed.
- Sources (all consulted 2026-07-02):
  - `google-gemini/gemini-cli` — `packages/core/src/services/chatRecordingService.ts`
    (Apache-2.0) — the writer: `appendRecord` does
    `JSON.stringify(record) + '\n'` → `fs.appendFileSync`.
  - `packages/core/src/services/chatRecordingTypes.ts` — `TokensSummary` /
    `MessageRecord` / `ConversationRecord` field names.
  - Session-management docs: <https://geminicli.com/docs/cli/session-management/>,
    DeepWiki <https://deepwiki.com/google-gemini/gemini-cli/3.9-session-management>.
  - Price rows already shipped: `data/prices/google.json` (SPEC-0005) — cited
    Gemini 2.5 rows; `gemini-2.5-pro` **omitted** (context-tiered, unrepresentable
    in the flat schema) → those turns are honestly unpriced (I2).

## On-disk format (ground truth)

- **Dir:** `~/.gemini/tmp/<projectHash>/chats/`. Subagent sessions nest one
  level deeper: `chats/<parentSessionId>/<sessionId>.jsonl`, with metadata
  `kind: "subagent"`.
- **Main filename:** `session-<YYYY-MM-DDTHH-mm>-<sessionId[:8]>.jsonl`
  (`SESSION_FILE_PREFIX = "session-"`).
- **Format:** append-only **JSONL**, one JSON record per line. Line variants:
  1. **Metadata** (first line): `{ sessionId, projectHash, startTime,
     lastUpdated, kind, directories, summary? }` — no `type` field.
  2. **Message**: `{ id, timestamp, type, content, displayContent? }` where
     `type` ∈ `{"user","gemini"}` (the discriminator is **`type`**, not `role`).
     A `"gemini"` message additionally carries `model`, `tokens`, `thoughts`,
     and `toolCalls`.
  3. **Metadata update**: `{ "$set": { … } }` (a `$set.messages` array is a
     checkpoint that clears + rebuilds the message list).
  4. **Rewind marker**: `{ "$rewindTo": "<messageId>" }` — drops that message
     and everything appended after it.
  - The loader **dedupes messages by `id`** (a re-appended message with the same
    `id` replaces the earlier copy — this is how tool results get merged into the
    turn that requested them). A naive line-sum would double-count usage; the
    adapter mirrors the last-wins Map + rewind truncation.
- **Per-turn `tokens` (`TokensSummary`)**, mapped 1:1 from the Gemini API's
  `GenerateContentResponseUsageMetadata`:
  `input`←`promptTokenCount`, `output`←`candidatesTokenCount`,
  `cached`←`cachedContentTokenCount`, `thoughts`←`thoughtsTokenCount`,
  `tool`←`toolUsePromptTokenCount`, `total`←`totalTokenCount`.

## Mapping to our `TokenUsage` (documented per field, I2/I3)

Gemini's `totalTokenCount` = prompt + candidates + thoughts + tool-use, with
`cachedContentTokenCount` a **subset of** `promptTokenCount`. So, mirroring
`codex.ts`'s no-under-report discipline:

- **`cacheRead` = `cached`** (priced at `input_cached`; google rows cite it).
- **`input` = (`input` − `cached`) + `tool`** — the non-cached prompt plus the
  tool-use prompt tokens (both billed at the input rate; the flat price schema
  has no separate tool rate, so folding into `input` prices them honestly rather
  than dropping them).
- **`output` = `output` + `thoughts`** — Gemini 2.5 reports thinking tokens
  **separately** from candidates and bills them at the output rate (google row
  excerpt: "Output price (including thinking tokens)"), so folding matches the
  cited rate without double-counting candidates.
- **`cacheCreation` = 0; `cacheCreation5m`/`1h` = undefined** — Gemini's usage
  metadata has **no cache-write counterpart** (implicit caching is automatic and
  priced only as a cached-**read** discount; `google.json` carries no
  `input_cache_write_*` rows), exactly like the Codex/OpenAI case.
- `withTotal` then recomputes `total` = input+output+cacheRead = the original
  `totalTokenCount`, keeping the receipt's token line self-consistent.

## Vendor resolution (R3)

Gemini CLI is **single-vendor** — it only runs Google models — so
`vendorForSource("gemini") → "google"` is unambiguous (no mixed-vendor turn to
disambiguate, unlike the Cursor concern in R3). The per-turn `model` id selects
the row **within** `google.json`; an id with no cited row (e.g.
`gemini-2.5-pro`) is unpriced and renders tokens only (I2). `vendorForModel`
already maps `gemini-*` → `google` (SPEC-0005), so no pricing-layer change beyond
the one-line `vendorForSource` case is required.

## Consequences for the implementation

- New `src/parse/gemini.ts` implementing `SessionAdapter`; reuse `util.ts`
  (`readJsonl`/`addUsage`/`withTotal`/`truncate`/`listFiles`) and mirror
  `codex.ts`. Root `~/.gemini/tmp`; discovery restricted to `**/chats/**.jsonl`.
- Wire the new source once: `AGENT_SOURCES` + `SOURCE_LABELS` (`"Gemini CLI"`),
  `vendorForSource` (`→ "google"`), and telemetry `AGENT_TYPE_VALUES` (so parse
  failures attribute to `gemini` rather than breaking the build on
  `toAgentTypeTelemetry`). Benchmark enums stay unchanged (gemini coarsely
  buckets to `unknown` there — out of SPEC-0015 scope).
- Per-tool wall-clock: only the **message** timestamp is recorded, not per tool
  call, so `ToolCall.startedAt/endedAt` stay **undefined** (no fabricated
  precision, I3); the turn keeps the real message timestamp for R4a.
- Edge cases covered by fixtures: priced multi-tool session; a
  no-price-row model (`gemini-2.5-pro`) → tokens-only; re-append dedupe +
  `$rewindTo` truncation; truncated/corrupt file → skip, exit 0.
