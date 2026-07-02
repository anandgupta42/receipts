# aireceipts

**Your AI coding agent says it's done. What did that actually cost?**

`aireceipts` reads an agent transcript off disk (Claude Code, Codex, more coming) and
prints a cost receipt: per-tool breakdown, waste lines, a counterfactual re-price, and a
block you can paste into a PR.

I'm building this in the open, as one person, not released yet — no npm install that
does anything useful today. Follow along or poke at the code; it'll get sharper fast.

Offline-complete, zero accounts, with opt-out diagnostics telemetry (never your
code, prompts, paths, or costs — schema in docs/telemetry.md; kill with
`AIRECEIPTS_TELEMETRY=off` or `DO_NOT_TRACK=1`) — I
don't want your transcripts and I built this so I never see them.

MIT licensed. If we ever meet in person, I owe you a samosa.
