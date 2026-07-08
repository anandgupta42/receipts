# Choose an integration

Start with the CLI. It is the stable product surface across coding assistants:

```sh
npx aireceipts-cli
npx aireceipts-cli setup
```

`setup` is read-only. It reports found sessions, the latest session cost or
tokens, the trailing-week total, and integration options. Nothing uploads, posts,
or writes settings from this command.

## Pick by intent

| I want | Use | Scope | Network |
|---|---|---|---|
| A receipt right now | `npx aireceipts-cli` | local | none |
| A first-run report | `npx aireceipts-cli setup` | local | none |
| Exact snippets for my assistant | `npx aireceipts-cli integrations [target]` | repo/user | none |
| Claude Code mini-receipts after sessions | `npx aireceipts-cli install-hook` | user | none |
| Claude Code prompt statusline | `aireceipts statusline` in `statusLine` config | user/repo | none |
| A weekly habit | `npx aireceipts-cli week` | local | none |
| PR receipt comments | `npx aireceipts-cli pr --post` | repo/PR | GitHub only when explicitly run |
| Team PR receipt presence checks | reusable GitHub workflow | repo | GitHub Actions only |
| Automatic PR receipt refs | workflow + `.claude/settings.json` hook | repo | GitHub Actions + git push |

## Recipes

```sh
npx aireceipts-cli integrations
npx aireceipts-cli integrations claude-code
npx aireceipts-cli integrations codex
npx aireceipts-cli integrations opencode
npx aireceipts-cli integrations cursor
npx aireceipts-cli integrations github
```

Each recipe states what works today, the command or snippet, files changed, undo
path, scope, and whether network is involved. Assistant recipes are intentionally
thin: they tell the assistant to run the CLI. They do not duplicate parsing,
pricing, attribution, or PR policy.

Per-agent pages — what a receipt can prove for each agent, where its
transcripts live, and its quick start: [docs/agents/](../agents/README.md).

## Day-1 value before hooks

You do not need hooks or PR comments to get value on day 1. Run a session in any
supported agent, then run:

```sh
npx aireceipts-cli setup
```

If prices are known for the model, setup shows dollars. If not, it shows tokens
only. That is the same honesty rule as receipts: no fallback prices, no guessed
dollars.

## PR rollout

PR receipts are useful for teams, but they should not be the first requirement
for every user. Keep the rollout explicit:

1. Use local receipts first.
2. Add assistant snippets or local hooks if they help the workflow.
3. For PR-producing tasks, run `npx aireceipts-cli pr --post`.
4. Add the reusable GitHub check when the team wants visibility.
5. Add the committed Claude Code hook when the team wants automatic ref production.
6. Keep enforcement opt-in; notice-only is the default.

CI checks for marked PR receipt comments and can post from a `refs/receipts/*` ref. It
does not generate receipts and does not read local transcripts. The workflow alone is a
no-op until the Claude hook, or a manual `npx aireceipts-cli pr --store ref --push-ref`,
produces that ref. Codex users run the manual command until Codex invokes lifecycle hooks.
