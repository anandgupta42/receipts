# Supported agents

One page per agent: what a receipt can prove there, where the transcripts
live, and how to wire it in. Depth is stated honestly per adapter — full
per-turn parsing where the agent records it, labeled degraded mode where it
doesn't (I3/I6).

| Agent | Depth | Page |
|---|---|---|
| Claude Code | Full: per-turn models, tools, cache tiers, subagents | [claude-code.md](claude-code.md) |
| Codex CLI | Full per-turn parsing + compaction pattern flags | [codex.md](codex.md) |
| Cursor | Honest degraded mode: session totals only | [cursor.md](cursor.md) |
| Gemini CLI | Full: per-turn models, tools, cache tokens | [gemini.md](gemini.md) |
| opencode | Full: per-message models, tools, cache read/write | [opencode.md](opencode.md) |

Adding an agent? The adapter contract and registry are described in
[docs/internal/harness.md](../internal/harness.md) and the `add-vendor-adapter`
skill; a new adapter ships with its page here (guarded by
`test/agent-pages.test.ts`).
