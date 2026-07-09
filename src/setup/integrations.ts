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

const NPM_NATIVE_PR_CHECK_CALLER_YAML = [
  "# npm-native, no reusable-workflow `uses:` — no org Actions-policy gate; for trusted",
  "# same-repo/internal PRs (fork PRs get a read-only token).",
  "name: aireceipts",
  "on: [pull_request]",
  "permissions:",
  "  contents: read",
  "  pull-requests: write",
  "jobs:",
  "  check:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: npx -y aireceipts-cli@latest pr-check",
  "        env:",
  "          GH_TOKEN: ${{ github.token }}",
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
    network: "none for local receipts; PR posting only with explicit pr --post",
    files: ["AGENTS.md", ".agents/skills/aireceipts/SKILL.md"],
    start: "add the snippet below to AGENTS.md or an aireceipts skill",
    undo: "remove the AGENTS.md/skill snippet",
    snippet: [
      "# Codex",
      "",
      "Add this instruction to the repo's AGENTS.md or an aireceipts skill:",
      "",
      "```text",
      ASSISTANT_INSTRUCTION,
      "```",
    ].join("\n"),
    notes: [
      "The integration is intentionally a thin instruction layer around the CLI.",
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
    label: "GitHub PR check + Claude auto-attach",
    status: "works today",
    scope: "external",
    network: "GitHub Actions plus local git push of refs/receipts/*; transcripts never upload",
    files: [".github/workflows/pr-receipt-check.yml", ".claude/settings.json"],
    start: "commit both the workflow and Claude Code hook below",
    undo: "remove .github/workflows/pr-receipt-check.yml and .claude/settings.json hook entry",
    snippet: [
      "# .github/workflows/pr-receipt-check.yml",
      "",
      "```yaml",
      "name: pr-receipt-check",
      "on: [pull_request]",
      "jobs:",
      "  check:",
      "    uses: anandgupta42/receipts/.github/workflows/pr-receipt-check.yml@latest",
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
      "{",
      '  "hooks": {',
      '    "PreToolUse": [',
      "      {",
      '        "matcher": "Bash",',
      '        "hooks": [',
      "          {",
      '            "type": "command",',
      '            "command": "npx -y aireceipts-cli@latest hook pre-push",',
      '            "timeout": 60',
      "          }",
      "        ]",
      "      }",
      "    ]",
      "  }",
      "}",
      "```",
    ].join("\n"),
    notes: [
      "Automatic PR receipts need both files: the workflow alone is a no-op until the hook, or a manual `pr --store ref --push-ref`, produces a ref.",
      "Do not enable the hook in a repo already running another refs/receipts/* producer; --push-ref force-updates that namespace.",
      "Codex is manual for now: run `npx aireceipts-cli pr --store ref --push-ref` until Codex invokes lifecycle hooks.",
      "notice-only is the default; same-repo enforcement is opt-in through the documented repo variable.",
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
