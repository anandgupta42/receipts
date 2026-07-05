# Day-1 integration strategy for aireceipts

Date: 2026-07-04

## Question

What is the best way to integrate aireceipts into a user's environment so it works across coding assistants, feels like one command, shows value on day 1, and does not depend on users adopting PR receipt review immediately?

## Recommendation

Do not choose "plugin" or "hook" as the primary product surface. Ship a layered adoption path:

1. **Universal core:** `npx aireceipts` is the day-1 value path and the only source of truth.
2. **Guided setup:** add `npx aireceipts setup` as the next product milestone. It should detect local agent logs, print the newest receipt, print the trailing week, and offer optional integrations.
3. **Agent-local automation:** use hooks/statuslines only for local visibility, never for network writes or PR posting.
4. **Assistant wrappers:** ship skills/plugins as thin instructions that call the CLI. Treat them as distribution and ergonomics, not the product core.
5. **Repo rollout:** keep PR receipts as an optional team layer: one reusable GitHub workflow, notice-only by default, opt-in enforcement.

The north star: a new user should run one command and see a receipt before being asked to configure hooks, plugins, CI, GitHub auth, or PR policy.

## Why this is the right shape

### Plugins are useful, but not portable enough to be the core

The platform docs show that plugins are real, but each assistant packages them differently:

- **Codex:** skills are the reusable workflow authoring layer; plugins are the installable distribution layer for stable skills, apps, MCP config, and hooks. Codex docs explicitly say to start with local skills while iterating, then package as a plugin when sharing across teams.
- **Claude Code:** standalone `.claude/` config is recommended for personal/project experiments; plugins are recommended for team/community sharing, versioned releases, reusable setup, and namespaced commands.
- **OpenCode:** plugins are TypeScript/JavaScript modules loaded from `.opencode/plugins/`, `~/.config/opencode/plugins/`, or npm packages. They hook into OpenCode-specific events such as `session.idle`, `tool.execute.before`, and `tool.execute.after`.
- **Cursor:** official docs expose Rules, Agent Skills, MCP, and CLI integration. Cursor supports `AGENTS.md`, `.cursor/skills/`, GitHub-imported skills/rules, MCP configuration, and non-interactive CLI, but this is not the same plugin contract as Claude, Codex, or OpenCode.

So the portable artifact is not "a plugin." The portable artifact is:

- a deterministic CLI command,
- plus assistant-specific wrappers that tell the assistant when to run it.

### Hooks are powerful, but too invasive for first contact

Hooks create recurring value when the user already trusts the tool, but they are not the first experience:

- They write into assistant settings.
- They vary by assistant.
- They can affect latency or lifecycle behavior.
- They create more trust burden than a read-only CLI command.

Use hooks for "show me my receipt automatically after a session," not "post to a PR automatically." PR posting requires GitHub state, `gh` auth, and can be externally visible. That should remain explicit: `npx aireceipts pr --post`.

### Day-1 value should not require a PR

Many users will not create a PR on day 1. Some will be testing locally, using agents for research, editing docs, or working in private repos without CI. The first value should be one of:

- "What did my last session cost?"
- "How much did I spend this week across agents?"
- "Where did the agent waste tokens?"
- "What should I paste into my next agent prompt to avoid that waste?"
- "Can I see live cost while I work?"

PR receipts are the team accountability layer, not the first user aha.

## Current product fit

The repo already has the primitives needed for the funnel:

- `npx aireceipts`: newest local session receipt.
- `npx aireceipts week`: trailing 7-day cross-agent digest.
- `npx aireceipts --handoff`: paste-ready guidance for cheaper next sessions.
- `npx aireceipts install-hook`: consent-gated Claude Code `SessionEnd` mini receipt.
- `npx aireceipts statusline`: Claude Code live statusline command.
- `npx aireceipts --check-budget`: advisory budget exit code.
- `npx aireceipts pr --post`: explicit PR finalizer for any assistant.
- Reusable GitHub workflow: notice-only PR receipt presence check, opt-in enforcement.

The gap is not core functionality. The gap is onboarding and packaging:

- `npx aireceipts` is still blocked by npm publication. `npm view aireceipts` returned 404 on 2026-07-04, and there are no GitHub releases.
- There is no single setup command that detects installed agents and offers the right next step per environment.
- Cross-assistant integration recipes are not yet packaged as a cohesive "choose your integration" experience.

## Proposed day-1 funnel

### Step 0: publish the CLI

Until npm exists, "one command" is not literal. This is a release blocker for adoption.

Required outcome:

```sh
npx aireceipts
```

prints a local receipt on macOS, Linux, Windows, CI, and ordinary repo checkouts without cloning this repo.

### Step 1: add `npx aireceipts setup`

This should be the main onboarding command, not a hook installer.

Suggested behavior:

```text
$ npx aireceipts setup

Found local agent sessions
  Claude Code: 18 sessions
  Codex: 7 sessions
  OpenCode: 3 sessions
  Cursor: 2 sessions (session totals only)

Latest receipt
  Claude Code · $0.18 · 147k tok · 2 waste flags

This week
  $3.42 priced · 2.1M tok · 30 sessions

Optional integrations
  [1] Claude Code: add SessionEnd mini receipt
  [2] Claude Code: add statusline
  [3] This repo: add notice-only PR receipt check
  [4] Print assistant instruction snippets
  [5] Skip
```

Rules:

- Always show value before asking to write config.
- Every write is consent-gated and shows the exact diff.
- No network by default.
- No PR posting from setup.
- If no sessions are found, show the supported transcript locations and next command to run after a session exists.

### Step 2: ship integration recipes, not just docs

Add a generated "integration kit" in docs and the package:

```sh
npx aireceipts integrations
npx aireceipts integrations claude-code
npx aireceipts integrations codex
npx aireceipts integrations opencode
npx aireceipts integrations cursor
npx aireceipts integrations github
```

Each page/command should answer:

- What works today.
- One command or snippet to enable it.
- What files are changed.
- How to undo it.
- Whether it is local-only, repo-shared, or externally visible.

### Step 3: provide assistant instructions

Give users a copy/paste instruction that works across assistants:

```text
When you finish a coding session, run `npx aireceipts` and summarize the receipt in the handoff.
Before you finish a PR-producing task, run `npx aireceipts pr --post` from the repo worktree and include any failure message in the handoff.
Never guess cost. If aireceipts reports tokens-only, preserve that.
```

For agents that support durable instructions, provide repo-specific snippets:

- `AGENTS.md` for Codex and Cursor.
- `CLAUDE.md` for Claude Code.
- `.opencode/commands/receipt.md` for OpenCode.
- `.cursor/skills/aireceipts/SKILL.md` for Cursor.
- `.agents/skills/aireceipts/SKILL.md` for Codex.
- `.claude/skills/aireceipts/SKILL.md` for Claude Code.

These should all call the same CLI. They should not implement pricing, parsing, or PR matching logic.

## Integration matrix

| Surface | Best first use | Why | Risk | Recommendation |
|---|---|---|---|---|
| CLI / `npx` | First receipt, week digest, handoff | Universal, deterministic, no assistant-specific setup | Requires npm publish and Node | Primary |
| Setup wizard | Guided one-command adoption | Converts "what now?" into value plus optional automation | Must stay non-magical and consent-gated | Build next |
| Claude Code hook | Automatic mini receipt at session end | Native `SessionEnd` hook exists; repo already supports it | Writes settings; Claude-only | Keep optional |
| Claude Code statusline | Live cost while working | Native statusline runs shell command with session JSON | Claude-only; statusline latency matters | Keep optional |
| OpenCode plugin | Automatic local notifications/receipt | OpenCode supports local/npm plugins and session events | OpenCode-specific package and Bun install path | Build after setup |
| Cursor skill/rule | Ask/agent workflow wrapper | Cursor supports rules, AGENTS.md, skills, MCP, CLI | Not a lifecycle hook equivalent | Ship recipe/skill first |
| Codex skill/plugin | Repeatable workflow wrapper | Codex supports skills; plugins distribute stable skills/hooks | Codex-specific marketplace/install flow | Ship skill first, plugin later |
| GitHub workflow | Team PR receipt presence check | One small reusable workflow; no CI receipt generation | PR-centric; may annoy if enforcing early | Notice-only default |
| PR hook automation | Auto-post receipts | Could feel magical | External write, auth, wrong timing, surprise comments | Avoid |

## What to build next

### SPEC candidate: Day-1 setup and integration kit

Scope:

- `aireceipts setup`
- `aireceipts integrations`
- generated assistant snippets
- docs updates that make CLI-first the default path

Acceptance criteria:

- A user with existing transcripts gets a receipt and weekly digest from one command before any config write.
- A user with Claude Code can install/uninstall the existing hook and statusline through setup with explicit diff confirmation.
- A user with OpenCode gets a command/skill recipe even before an OpenCode plugin exists.
- A user with Cursor gets an `AGENTS.md`/skill recipe, not a promise of hook support.
- A maintainer can add the PR check from setup, but it remains notice-only unless explicitly configured.
- Setup is deterministic and local-first; no transcript upload; no product-path network.
- The docs have one "Choose your integration" page with the matrix above.

### SPEC candidate: OpenCode plugin wrapper

Scope:

- npm-published OpenCode plugin that listens for `session.idle` and shells out to `npx aireceipts --mini` or `aireceipts --mini`.
- local-only output/notification by default.
- no PR posting, no network writes.

Build this after `setup`, because the setup command can tell OpenCode users how to install it once it exists.

### SPEC candidate: Codex/Claude/Cursor skill pack

Scope:

- one canonical `SKILL.md` workflow for "run receipt", "run weekly digest", "post PR receipt if asked".
- packaged into assistant-specific locations or plugin manifests.
- no duplicated business logic.

This is a good distribution layer once the command-line experience is stable.

## UX rules

- Show value before asking for trust.
- Default to local-only.
- Never auto-post externally visible artifacts from a hook.
- Make every write reversible.
- Keep PR enforcement opt-in.
- Make tokens-first behavior explicit for unknown provider/model prices.
- Prefer "receipt now" and "week total" over "configure your CI" in first-run docs.

## Decision

The best integration strategy is **CLI-first with optional assistant-native automation**.

Ship the npm CLI and setup wizard first. Use hooks/statuslines to make value recurring after trust is established. Use plugins and skills as thin wrappers once the core flow is proven. Keep PR receipts explicit for contributors and notice-only for teams by default.

## Sources

- Local repo docs: `README.md`, `docs/guide/01-getting-started.md`, `docs/guide/03-install-hook.md`, `docs/guide/07-statusline.md`, `docs/guide/08-budget.md`, `docs/pr-receipts.md`.
- Local code graph: indexed project `Users-anandgupta-codebase-aireceipts`, architecture and integration-surface search.
- Codex manual fetched 2026-07-04: skills, plugins, hooks, AGENTS.md, GitHub Action, non-interactive mode.
- Claude Code docs: hooks, statusline, settings scopes, skills, plugins, GitHub Actions.
- OpenCode docs: plugins, commands, config, CLI.
- Cursor docs: Rules, Agent Skills, CLI MCP, CLI usage.
- GitHub Actions docs: reusable workflows and `workflow_call`.
