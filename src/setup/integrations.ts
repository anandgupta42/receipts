export const INTEGRATION_TARGETS = ["claude-code", "codex", "opencode", "cursor", "github"] as const;

export type IntegrationTarget = (typeof INTEGRATION_TARGETS)[number];

export interface IntegrationRecipe {
  target: IntegrationTarget;
  label: string;
  status: string;
  scope: "local" | "user" | "repo" | "external";
  network: string;
  files: string[];
  start: string;
  undo: string;
  snippet: string;
  notes: string[];
}

const ASSISTANT_INSTRUCTION = [
  "When you finish a coding session, run `npx aireceipts-cli` and summarize the receipt in the handoff.",
  "Before you finish a PR-producing task, run `npx aireceipts-cli pr --post` from the repo worktree and include any failure message in the handoff.",
  "Never guess cost. If aireceipts reports tokens-only, preserve that.",
].join("\n");

const AGENT_PRE_PUSH_HOOK_JSON = [
  "{",
  '  "hooks": {',
  '    "PreToolUse": [',
  "      {",
  '        "matcher": "Bash",',
  '        "hooks": [',
  "          {",
  '            "type": "command",',
  '            "command": "npx -y aireceipts-cli@latest hook pre-push || true",',
  '            "timeout": 60',
  "          }",
  "        ]",
  "      }",
  "    ]",
  "  }",
  "}",
].join("\n");

const REUSABLE_PR_CHECK_CALLER_YAML = [
  "# Adopt the aireceipts PR-receipt check in any repo: paste this file at",
  "# .github/workflows/pr-receipt-check.yml. It is notice-only by default; set",
  "# AIRECEIPTS_REQUIRE_PR_RECEIPT=true to enforce same-repo PRs. Generation is",
  "# local; see https://github.com/anandgupta42/receipts/blob/main/docs/pr-receipts.md.",
  "# `@latest` is a moving tag that tracks the newest published release and is",
  "# advanced on every publish (SPEC-0064 R1); pin a `v*` tag instead for a frozen ref.",
  "name: pr-receipt-check",
  "on: [pull_request]",
  "permissions:",
  "  contents: read",
  "  pull-requests: write",
  "jobs:",
  "  check:",
  "    uses: anandgupta42/receipts/.github/workflows/pr-receipt-check.yml@latest",
].join("\n");

const NPM_NATIVE_PR_CHECK_CALLER_YAML = [
  "# npm-native, no reusable-workflow `uses:` — no org Actions-policy gate; for trusted",
  "# same-repo/internal PRs (fork PRs get a read-only token).",
  "name: aireceipts",
  "on: [pull_request]",
  "permissions:",
  "  contents: read",
  "  pull-requests: write",
  "# One run per branch; a rapid re-push cancels the in-flight one so two runs",
  "# can't race to post duplicate receipts.",
  "concurrency:",
  "  group: aireceipts-${{ github.workflow }}-${{ github.ref }}",
  "  cancel-in-progress: true",
  "jobs:",
  "  check:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      # Fail open in notice-only mode and for forks. On same-repo PRs, setting the",
  "      # repo variable to exactly true makes pr-check exit 1 a real check failure.",
  "      - run: npx -y aireceipts-cli@latest pr-check",
  "        continue-on-error: ${{ vars.AIRECEIPTS_REQUIRE_PR_RECEIPT != 'true' || github.event.pull_request.head.repo.full_name != github.repository }}",
  "        env:",
  "          GH_TOKEN: ${{ github.token }}",
  "          AIRECEIPTS_REQUIRE_PR_RECEIPT: ${{ vars.AIRECEIPTS_REQUIRE_PR_RECEIPT }}",
  "          # Optional: branches exempt from enforcement (anchored globs, space-",
  "          # separated). pr-check defaults to release/* when this is unset.",
  "          AIRECEIPTS_RECEIPT_EXEMPT_GLOBS: ${{ vars.AIRECEIPTS_RECEIPT_EXEMPT_GLOBS }}",
].join("\n");

export const INTEGRATION_RECIPES: readonly IntegrationRecipe[] = [
  {
    target: "claude-code",
    label: "Claude Code",
    status: "works today",
    scope: "user",
    network: "none for local receipts; PR posting only with explicit pr --post",
    files: ["~/.claude/settings.json", "CLAUDE.md or .claude/skills/aireceipts/SKILL.md"],
    start: "npx aireceipts-cli install-hook",
    undo: "npx aireceipts-cli uninstall-hook",
    snippet: [
      "# Claude Code",
      "",
      "Run this for an automatic mini-receipt after every Claude Code session:",
      "",
      "```sh",
      "npx aireceipts-cli install-hook",
      "```",
      "",
      "Optional assistant instruction:",
      "",
      "```text",
      ASSISTANT_INSTRUCTION,
      "```",
    ].join("\n"),
    notes: [
      "Hook installation is consent-gated and prints the settings diff before writing.",
      "Statusline users can run `aireceipts statusline`; setup does not overwrite existing statusLine config.",
    ],
  },
  {
    target: "codex",
    label: "Codex",
    status: "works today",
    scope: "repo",
    network: "the pre-push hook pushes refs/aireceipts/*; explicit pr --post posts the comment",
    files: [".codex/hooks.json", "AGENTS.md", ".agents/skills/aireceipts/SKILL.md"],
    start: "commit .codex/hooks.json and add the finalizer instruction below",
    undo: "remove the hook and the AGENTS.md/skill snippet",
    snippet: [
      "# .codex/hooks.json",
      "",
      "```json",
      AGENT_PRE_PUSH_HOOK_JSON,
      "```",
      "",
      "Trust the project, then review and trust the exact hook definition once with `/hooks`.",
      "",
      "Keep this finalizer in the repo's AGENTS.md or an aireceipts skill as the fallback:",
      "",
      "```text",
      ASSISTANT_INSTRUCTION,
      "```",
    ].join("\n"),
    notes: [
      "Codex project hooks run only for trusted projects after the exact hook definition is reviewed and trusted.",
      "PreToolUse shell interception is currently incomplete for unified_exec, so keep the finalizer instruction and enable the PR check for a merge-time backstop.",
      "The integration stays a thin hook/instruction layer around the CLI.",
      "No parser, pricing, or receipt policy logic belongs in the assistant wrapper.",
    ],
  },
  {
    target: "opencode",
    label: "opencode",
    status: "works today",
    scope: "repo",
    network: "none for local receipts; PR posting only with explicit pr --post",
    files: [".opencode/commands/receipt.md"],
    start: "add the command file below",
    undo: "remove .opencode/commands/receipt.md",
    snippet: [
      "# .opencode/commands/receipt.md",
      "",
      "```md",
      "---",
      "description: Print the local aireceipts summary",
      "---",
      "",
      "Run `npx aireceipts-cli` from this repo and summarize the receipt.",
      "For PR-producing tasks, run `npx aireceipts-cli pr --post` and include any failure message in the handoff.",
      "Never guess cost; preserve tokens-only output when a model is unpriced.",
      "```",
    ].join("\n"),
    notes: [
      "A JavaScript/TypeScript opencode plugin is optional future packaging, not required for day-1 value.",
      "The command file keeps the integration portable across repos.",
    ],
  },
  {
    target: "cursor",
    label: "Cursor",
    status: "works today",
    scope: "repo",
    network: "none for local receipts; PR posting only with explicit pr --post",
    files: [".cursor/rules/aireceipts.mdc", ".cursor/skills/aireceipts/SKILL.md"],
    start: "add the rule/skill snippet below",
    undo: "remove the Cursor rule or skill folder",
    snippet: [
      "# Cursor rule or skill",
      "",
      "```text",
      ASSISTANT_INSTRUCTION,
      "```",
    ].join("\n"),
    notes: [
      "Cursor logs do not currently provide per-turn attribution, so receipts may be tokens-only or degraded.",
      "This recipe does not claim a lifecycle hook; it uses rules/skills that call the CLI.",
    ],
  },
  {
    target: "github",
    label: "GitHub PR check + agent auto-attach",
    status: "works today",
    scope: "external",
    network: "GitHub Actions plus local git push of refs/aireceipts/*; transcripts never upload",
    files: [".github/workflows/pr-receipt-check.yml", ".claude/settings.json", ".codex/hooks.json", "AGENTS.md"],
    start: "commit the workflow plus the hook/instruction for each coding agent you use",
    undo: "remove the workflow and the agent hook/instruction entries",
    snippet: [
      "# .github/workflows/pr-receipt-check.yml",
      "",
      "```yaml",
      REUSABLE_PR_CHECK_CALLER_YAML,
      "```",
      "",
      "ALTERNATIVE: self-contained npm-native pr-check",
      "",
      "Use this workflow content instead when org Actions policy blocks external reusable workflows:",
      "",
      "```yaml",
      NPM_NATIVE_PR_CHECK_CALLER_YAML,
      "```",
      "",
      "# .claude/settings.json",
      "",
      "```json",
      AGENT_PRE_PUSH_HOOK_JSON,
      "```",
      "",
      "# .codex/hooks.json",
      "",
      "```json",
      AGENT_PRE_PUSH_HOOK_JSON,
      "```",
      "",
      "# AGENTS.md (Codex fallback for shell paths hooks do not intercept)",
      "",
      "```text",
      ASSISTANT_INSTRUCTION,
      "```",
    ].join("\n"),
    notes: [
      "Automatic PR receipts need the workflow plus a producer hook for each agent in use; the workflow alone is a no-op until a hook, or a manual `pr --store ref --push-ref`, produces a ref.",
      "Safe to run alongside another refs/receipts/* producer: aireceipts uses its own refs/aireceipts/* namespace and never reads or writes refs/receipts/*.",
      "Codex project hooks require a trusted project and one-time review through `/hooks`; keep the AGENTS.md finalizer because unified_exec interception is incomplete.",
      "Notice-only is the default; set AIRECEIPTS_REQUIRE_PR_RECEIPT=true for the same-repo merge-time backstop.",
      "Mark the receipt-check job as required in the target branch ruleset; a failing optional check cannot block merge.",
      "Fork PRs stay advisory, and CI never generates receipts or reads transcripts.",
    ],
  },
];

export function integrationRecipe(target: string | undefined): IntegrationRecipe | undefined {
  return INTEGRATION_RECIPES.find((recipe) => recipe.target === target);
}

export function isIntegrationTarget(value: string): value is IntegrationTarget {
  return (INTEGRATION_TARGETS as readonly string[]).includes(value);
}
