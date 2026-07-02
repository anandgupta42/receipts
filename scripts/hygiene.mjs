#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const LINE_BUDGETS = Object.freeze([
  {
    file: "AGENTS.md",
    maxLines: 150,
    rationale: "bloat measurably degrades agent performance",
  },
  {
    file: "CLAUDE.md",
    maxLines: 3,
    rationale: "CLAUDE.md must stay a pointer; bloat measurably degrades agent performance",
  },
]);

export const ROOT_ALLOWLIST = Object.freeze([
  ".claude",
  ".github",
  ".gitleaksignore",
  ".gitignore",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "NOTICE",
  "CLAUDE.md",
  "README.md",
  "SECURITY.md",
  "data",
  "docs",
  "site",
  "eslint.config.js",
  "eval",
  "goldens",
  "package-lock.json",
  "package.json",
  "scripts",
  "specs",
  "src",
  "stryker.config.json",
  "test",
  "tsconfig.json",
  "tsup.config.ts",
  "vitest.config.ts",
]);

export const PR_TITLE_RULE = Object.freeze({
  types: Object.freeze(["feat", "fix", "docs", "chore", "test", "refactor", "ci", "perf"]),
  maxSubjectLength: 72,
  bannedPhrases: Object.freeze(["founder", "Altimate"]),
  example: "feat: add receipt parser",
});

const MOVE_OR_DELETE = "agents treat root files as authoritative — move it to docs/ or delete it";
const REASON_COMMENT = /^#\s*reason:\s*\S/im;

export function countLines(text) {
  if (text.length === 0) return 0;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

export function checkLineBudgets(rootDir = process.cwd(), budgets = LINE_BUDGETS) {
  const violations = [];

  for (const budget of budgets) {
    const filePath = join(rootDir, budget.file);
    let text;
    try {
      text = readFileSync(filePath, "utf8");
    } catch (error) {
      violations.push(`${budget.file}: cannot read file (${error.code ?? "unknown error"})`);
      continue;
    }

    const lines = countLines(text);
    if (lines > budget.maxLines) {
      violations.push(
        `${budget.file}: ${lines} lines exceeds ${budget.maxLines}-line budget; ${budget.rationale}.`,
      );
    }
  }

  return violations;
}

export function topLevelEntry(file) {
  return file.split("/")[0] ?? "";
}

export function checkRootAllowlist(trackedFiles, allowlist = ROOT_ALLOWLIST) {
  const allowed = new Set(allowlist);
  const roots = new Set(trackedFiles.map(topLevelEntry).filter(Boolean));
  const unexpected = [...roots].filter((root) => !allowed.has(root)).sort();

  return unexpected.map((root) => `unexpected tracked top-level entry "${root}": ${MOVE_OR_DELETE}`);
}

export function checkPrTitle(title, rule = PR_TITLE_RULE) {
  const violations = [];
  const trimmed = title.trim();
  const lowered = trimmed.toLowerCase();
  const banned = rule.bannedPhrases.filter((phrase) => lowered.includes(phrase.toLowerCase()));

  if (banned.length > 0) {
    violations.push(`PR title contains banned phrase(s): ${rule.bannedPhrases.join(", ")}`);
  }

  const match = /^(?<type>[a-z]+)(?:\((?<scope>[a-z0-9._/-]+)\))?: (?<subject>.+)$/u.exec(trimmed);
  if (!match?.groups) {
    violations.push(
      `PR title must match "type(scope)?: subject" with type one of ${rule.types.join("|")}; example: "${rule.example}"`,
    );
    return violations;
  }

  if (!rule.types.includes(match.groups.type)) {
    violations.push(`PR title type "${match.groups.type}" must be one of ${rule.types.join("|")}`);
  }

  if (match.groups.subject.length > rule.maxSubjectLength) {
    violations.push(
      `PR title subject is ${match.groups.subject.length} chars; maximum is ${rule.maxSubjectLength}`,
    );
  }

  return violations;
}

export function checkGitleaksIgnoreText(text, file = ".gitleaksignore") {
  const violations = [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const previous = lines[index - 1] ?? "";
    if (!REASON_COMMENT.test(previous)) {
      violations.push(`${file}:${index + 1}: suppression entry requires a preceding "# reason:" comment`);
    }
  }

  return violations;
}

export function checkGitleaksIgnore(rootDir = process.cwd()) {
  const filePath = join(rootDir, ".gitleaksignore");
  if (!existsSync(filePath)) return [];
  return checkGitleaksIgnoreText(readFileSync(filePath, "utf8"));
}

export function formatFalsePositiveEntry({ date, gate, cause, action }) {
  return `${date} · ${gate} · ${cause} · ${action}`;
}

export function isFalsePositiveEntry(line) {
  return /^\d{4}-\d{2}-\d{2} · [^·\n]+ · [^·\n]+ · [^·\n]+$/u.test(line);
}

export function getTrackedFiles(rootDir = process.cwd()) {
  const output = execFileSync("git", ["ls-files"], { cwd: rootDir, encoding: "utf8" });
  return output.split("\n").filter(Boolean);
}

export function runHygiene({ rootDir = process.cwd(), title, trackedFiles } = {}) {
  const files = trackedFiles ?? getTrackedFiles(rootDir);
  return [
    ...checkLineBudgets(rootDir),
    ...checkRootAllowlist(files),
    ...checkGitleaksIgnore(rootDir),
    ...(title === undefined ? [] : checkPrTitle(title)),
  ];
}

function parseArgs(argv) {
  const parsed = { title: undefined, help: false, errors: [] };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--title") {
      const value = argv[index + 1];
      if (value === undefined) {
        parsed.errors.push("--title requires a value");
      } else {
        parsed.title = value;
        index++;
      }
      continue;
    }
    if (arg.startsWith("--title=")) {
      parsed.title = arg.slice("--title=".length);
      continue;
    }
    parsed.errors.push(`unknown argument: ${arg}`);
  }

  return parsed;
}

function helpText() {
  return `Usage:
  node scripts/hygiene.mjs [--title "<PR title>"]

Runs the fast local hygiene gates:
  R1 constitution budgets: AGENTS.md <= 150 lines, CLAUDE.md <= 3 lines
  R2 tracked root allowlist from git ls-files
  R6 .gitleaksignore suppression entries require preceding "# reason:" comments
  R3 PR-title lint when --title is provided

CI-only or slower commands:
  R4 determinism: node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs
  R5 workflow lint: actionlint .github/workflows/*.yml .github/workflows/*.yaml
  R6 PR secret diff scan: gitleaks git --log-opts="<base>..HEAD" --redact --exit-code 1 .
  R6 full-history secret scan: gitleaks git --log-opts="--all" --redact --exit-code 1 .
`;
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(helpText());
    process.exit(0);
  }
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) console.error(`hygiene: ${error}`);
    process.stderr.write(helpText());
    process.exit(1);
  }

  const violations = runHygiene({ title: parsed.title });
  if (violations.length > 0) {
    console.error(`hygiene: ${violations.length} violation(s):`);
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exit(1);
  }

  console.log(parsed.title === undefined ? "hygiene: OK." : "hygiene: OK, including PR title.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
