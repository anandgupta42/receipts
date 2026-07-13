import { createHash } from "node:crypto";
import { posix as posixPath } from "node:path";
import type { AgentSource, Session, TokenUsage, ToolCall } from "../parse/types.js";
import { emptyUsage, sanitizeText, scaleUsage } from "../parse/util.js";
import { toolCallInvocations } from "../pr/gitWrite.js";
import { defaultDataDir } from "../pricing/priceTable.js";
import { priceSessionTurn } from "../pricing/resolve.js";
import { canonicalRecordedInput } from "../pricing/waste.js";

export type ReviewActionOutcome = "ok" | "error" | "running" | "unknown";

export interface ReviewAction {
  /** Stable zero-based order across every recorded tool call in the session. */
  index: number;
  turnIndex: number;
  /** Sanitized, bounded tool label. Never an input-derived value. */
  tool: string;
  /** Hash-only equality key. Missing when either tool or recorded JSON input is absent. */
  identityHash?: string;
  inputHash?: string;
  outcome: ReviewActionOutcome;
  directWrite: boolean;
  sourceWrite: boolean;
  fileReadKeys: string[];
  fileWriteKeys: string[];
  validationKey?: ValidationKey;
  validationSuccess: boolean;
  attributedTokens: TokenUsage;
  attributedUsd: number | null;
  durationMs: number | null;
}

export type ValidationKey =
  | "biome"
  | "cargo-check"
  | "cargo-clippy"
  | "cargo-test"
  | "composer-test"
  | "database-check"
  | "dotnet-build"
  | "dotnet-test"
  | "eslint"
  | "go-test"
  | "go-vet"
  | "gradle-check"
  | "gradle-test"
  | "jest"
  | "lint-script"
  | "make-check"
  | "maven-test"
  | "maven-verify"
  | "mypy"
  | "phpunit"
  | "pytest"
  | "pyright"
  | "rspec"
  | "rubocop"
  | "ruff"
  | "test-script"
  | "tsc"
  | "typecheck-script"
  | "verify-script"
  | "vitest";

export type RuntimeReviewCapability =
  | "canonical-file-read"
  | "canonical-file-write"
  | "canonical-source-write"
  | "canonical-validation"
  | "canonical-write"
  | "compaction-events"
  | "pricing-units"
  | "tool-input"
  | "tool-name"
  | "tool-status"
  | "turn-output-tokens"
  | "turn-tool-count"
  | "turn-usage";

const DIRECT_WRITE_TOOLS = new Set([
  "Edit",
  "NotebookEdit",
  "Write",
  "apply_patch",
  "create_file",
  "edit",
  "edit_file",
  "multi_edit",
  "patch",
  "replace",
  "str_replace_editor",
  "write",
  "write_file",
]);

const FILE_READ_TOOLS = new Set(["Read", "read", "read_file", "view_file"]);

const PATH_KEYS = new Set([
  "file",
  "filePath",
  "file_path",
  "filename",
  "notebook_path",
  "path",
  "relative_path",
  "target",
  "target_file",
]);

const SOURCE_EXTENSIONS = new Set([
  ".astro",
  ".bash",
  ".c",
  ".cc",
  ".clj",
  ".cljs",
  ".coffee",
  ".cpp",
  ".cs",
  ".css",
  ".dart",
  ".ex",
  ".exs",
  ".fs",
  ".fsx",
  ".go",
  ".graphql",
  ".gql",
  ".h",
  ".hpp",
  ".html",
  ".ipynb",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".lua",
  ".m",
  ".mm",
  ".php",
  ".pl",
  ".proto",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".sass",
  ".scala",
  ".scss",
  ".sh",
  ".sol",
  ".sql",
  ".svelte",
  ".swift",
  ".tf",
  ".tsx",
  ".ts",
  ".vue",
  ".wasm",
  ".zig",
]);

const EXCLUDED_SOURCE_SEGMENTS = new Set([
  ".github",
  "build",
  "config",
  "configs",
  "coverage",
  "dist",
  "doc",
  "docs",
  "documentation",
  "generated",
  "node_modules",
  "vendor",
]);

const SCRIPT_KIND: Readonly<Record<string, ValidationKey>> = {
  check: "make-check",
  lint: "lint-script",
  test: "test-script",
  typecheck: "typecheck-script",
  "type-check": "typecheck-script",
  verify: "verify-script",
};

const DIRECT_VALIDATORS: Readonly<Record<string, ValidationKey>> = {
  biome: "biome",
  eslint: "eslint",
  jest: "jest",
  mypy: "mypy",
  phpunit: "phpunit",
  pyright: "pyright",
  pytest: "pytest",
  rspec: "rspec",
  rubocop: "rubocop",
  ruff: "ruff",
  tsc: "tsc",
  vitest: "vitest",
};

const STRUCTURED_VALIDATION_TOOLS: Readonly<Record<string, ValidationKey>> = {
  dbt_build: "database-check",
  dbt_compile: "database-check",
  dbt_test: "database-check",
  lint: "lint-script",
  run_test: "test-script",
  run_tests: "test-script",
  test: "test-script",
  typecheck: "typecheck-script",
};

/** Fixed display labels only. Custom tool and MCP server names may contain project data. */
const DISPLAY_TOOL_NAMES = new Set([
  "ApplyPatch",
  "AskUserQuestion",
  "Bash",
  "Edit",
  "Glob",
  "Grep",
  "NotebookEdit",
  "Read",
  "ReadFile",
  "Shell",
  "Skill",
  "Task",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "Write",
  "apply_patch",
  "bash",
  "create_file",
  "dbt_build",
  "dbt_compile",
  "dbt_test",
  "edit",
  "edit_file",
  "exec_command",
  "glob",
  "grep",
  "lint",
  "multi_edit",
  "patch",
  "question",
  "read",
  "read_file",
  "replace",
  "run_test",
  "run_tests",
  "shell",
  "str_replace_editor",
  "task",
  "test",
  "todowrite",
  "typecheck",
  "view_file",
  "view_image",
  "webfetch",
  "websearch",
  "write",
  "write_file",
  "write_stdin",
]);

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function boundedToolName(value: string): string {
  const clean = sanitizeText(value).trim();
  if (!/^[A-Za-z0-9_:-]{1,128}$/u.test(clean)) {
    return "other-tool";
  }
  const candidate = clean.startsWith("mcp__") && clean.includes("__", "mcp__".length)
    ? clean.slice(clean.indexOf("__", "mcp__".length) + 2)
    : clean;
  return DISPLAY_TOOL_NAMES.has(candidate) ? candidate : "other-tool";
}

function basename(command: string): string {
  return posixPath.basename(command.replaceAll("\\", "/")).replace(/\.(?:cmd|exe)$/iu, "").toLowerCase();
}

function scriptKind(value: string | undefined): ValidationKey | undefined {
  if (!value) {
    return undefined;
  }
  const base = value.toLowerCase().split(":")[0];
  return SCRIPT_KIND[base];
}

function skipEnvironment(argv: readonly string[]): string[] {
  let index = 0;
  if (basename(argv[index] ?? "") === "env") {
    index++;
  }
  while (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(argv[index] ?? "")) {
    index++;
  }
  return argv.slice(index);
}

function classifyPackageCommand(tool: string, args: readonly string[]): ValidationKey | undefined {
  if (tool === "npm") {
    const first = args[0]?.toLowerCase();
    return scriptKind(first === "run" || first === "run-script" ? args[1] : first);
  }
  if (tool === "pnpm" || tool === "yarn" || tool === "bun") {
    const first = args[0]?.toLowerCase();
    if (first === "exec" || tool === "bun" && first === "x") {
      return classifyArgv(args.slice(1));
    }
    return scriptKind(first === "run" ? args[1] : first);
  }
  if (tool === "npx" || tool === "bunx") {
    return classifyArgv(args);
  }
  return undefined;
}

function classifyArgv(rawArgv: readonly string[]): ValidationKey | undefined {
  const argv = skipEnvironment(rawArgv);
  if (argv.length === 0) {
    return undefined;
  }
  const tool = basename(argv[0]);
  const args = argv.slice(1);

  const packageCommand = classifyPackageCommand(tool, args);
  if (packageCommand) {
    return packageCommand;
  }
  if ((tool === "uv" || tool === "poetry" || tool === "pipenv") && args[0]?.toLowerCase() === "run") {
    return classifyArgv(args.slice(1));
  }
  if ((tool === "python" || tool === "python3") && args[0] === "-m") {
    return classifyArgv(args.slice(1));
  }
  if (tool === "bundle" && args[0]?.toLowerCase() === "exec") {
    return classifyArgv(args.slice(1));
  }

  const direct = DIRECT_VALIDATORS[tool];
  if (direct) {
    if (tool === "biome" && !["check", "lint", "ci"].includes(args[0]?.toLowerCase() ?? "")) {
      return undefined;
    }
    if (tool === "ruff" && !["check", "format"].includes(args[0]?.toLowerCase() ?? "")) {
      return undefined;
    }
    return direct;
  }

  if (tool === "cargo") {
    const subcommand = args[0]?.toLowerCase();
    return subcommand === "test"
      ? "cargo-test"
      : subcommand === "check"
        ? "cargo-check"
        : subcommand === "clippy"
          ? "cargo-clippy"
          : undefined;
  }
  if (tool === "go") {
    return args[0] === "test" ? "go-test" : args[0] === "vet" ? "go-vet" : undefined;
  }
  if (tool === "gradle" || tool === "gradlew") {
    const tasks = args.filter((arg) => !arg.startsWith("-")).map((arg) => arg.toLowerCase());
    return tasks.some((arg) => /(^|:)test$/u.test(arg))
      ? "gradle-test"
      : tasks.some((arg) => /(^|:)check$/u.test(arg))
        ? "gradle-check"
        : undefined;
  }
  if (tool === "mvn" || tool === "mvnw") {
    const goals = args.filter((arg) => !arg.startsWith("-")).map((arg) => arg.toLowerCase());
    return goals.includes("verify") ? "maven-verify" : goals.includes("test") ? "maven-test" : undefined;
  }
  if (tool === "dotnet") {
    return args[0] === "test" ? "dotnet-test" : args[0] === "build" ? "dotnet-build" : undefined;
  }
  if (tool === "make" || tool === "just") {
    return scriptKind(args.find((arg) => !arg.startsWith("-")));
  }
  if (tool === "composer") {
    return args[0]?.toLowerCase() === "test" ? "composer-test" : undefined;
  }
  return undefined;
}

function validationKey(call: ToolCall, tool: string): ValidationKey | undefined {
  if (call.shell === true) {
    for (const invocation of toolCallInvocations(call)) {
      const key = classifyArgv(invocation);
      if (key) {
        return key;
      }
    }
    return undefined;
  }
  const lower = tool.toLowerCase();
  let normalized = lower.replace(/^mcp_+/u, "");
  if (lower.startsWith("mcp__")) {
    const serverAndTool = lower.slice("mcp__".length);
    const separator = serverAndTool.indexOf("__");
    normalized = separator === -1 ? serverAndTool : serverAndTool.slice(separator + 2);
  }
  return STRUCTURED_VALIDATION_TOOLS[normalized];
}

function structuredExitCode(value: unknown, depth = 0): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 2) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["exit_code", "exitCode", "code"]) {
    const candidate = record[key];
    if (typeof candidate === "number" && Number.isSafeInteger(candidate)) {
      return candidate;
    }
  }
  for (const key of ["result", "metadata", "details"]) {
    const nested = structuredExitCode(record[key], depth + 1);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

export function actionOutcome(call: ToolCall): ReviewActionOutcome {
  if (call.status === "running") {
    return "running";
  }
  if (call.status === "error") {
    return "error";
  }
  const exitCode = call.shell === true ? structuredExitCode(call.output) : undefined;
  if (exitCode !== undefined && exitCode !== 0) {
    return "error";
  }
  return call.status === "ok" || exitCode === 0 ? "ok" : "unknown";
}

function collectPathValues(value: unknown, out: string[], depth = 0): void {
  if (!value || typeof value !== "object" || depth > 4) {
    return;
  }
  if (Array.isArray(value)) {
    for (const member of value) {
      collectPathValues(member, out, depth + 1);
    }
    return;
  }
  for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
    if (PATH_KEYS.has(key) && typeof member === "string" && member.trim()) {
      out.push(member);
    } else if (member && typeof member === "object") {
      collectPathValues(member, out, depth + 1);
    }
  }
}

function patchText(input: unknown): string | undefined {
  if (typeof input === "string") {
    return input;
  }
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  for (const key of ["patch", "input", "text"]) {
    if (typeof record[key] === "string") {
      return record[key] as string;
    }
  }
  return undefined;
}

function pathsOf(call: ToolCall, directWrite: boolean): string[] {
  const paths: string[] = [];
  collectPathValues(call.input, paths);
  if (directWrite && call.name === "apply_patch") {
    const patch = patchText(call.input);
    if (patch) {
      for (const match of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gmu)) {
        paths.push(match[1]);
      }
      for (const match of patch.matchAll(/^\*\*\* Move to: (.+)$/gmu)) {
        paths.push(match[1]);
      }
    }
  }
  return paths;
}

function normalizePath(value: string): string | undefined {
  const trimmed = value.trim().replace(/^['"]|['"]$/gu, "").replaceAll("\\", "/");
  if (!trimmed || trimmed.includes("\0")) {
    return undefined;
  }
  return posixPath.normalize(trimmed).replace(/(?!^)\/+$/u, "");
}

function isSourcePath(value: string): boolean {
  const normalized = normalizePath(value);
  if (!normalized) {
    return false;
  }
  const segments = normalized.toLowerCase().split("/").filter(Boolean);
  if (segments.some((segment) => EXCLUDED_SOURCE_SEGMENTS.has(segment))) {
    return false;
  }
  return SOURCE_EXTENSIONS.has(posixPath.extname(normalized).toLowerCase());
}

function pathKeys(paths: readonly string[]): string[] {
  return [...new Set(paths.map(normalizePath).filter((path): path is string => path !== undefined).map(hash))].sort();
}

export function runtimeCapabilities(source: AgentSource): ReadonlySet<RuntimeReviewCapability> {
  const capabilities = new Set<RuntimeReviewCapability>(["tool-name", "tool-status", "turn-tool-count"]);
  if (source !== "gemini") {
    capabilities.add("tool-input");
  }
  if (source === "claude-code" || source === "codex" || source === "opencode" || source === "cursor") {
    capabilities.add("canonical-write");
    capabilities.add("canonical-source-write");
    capabilities.add("canonical-validation");
  }
  if (source === "claude-code") {
    capabilities.add("canonical-file-read");
    capabilities.add("canonical-file-write");
  }
  if (source === "claude-code" || source === "codex") {
    capabilities.add("compaction-events");
  }
  if (source !== "cursor") {
    capabilities.add("turn-usage");
    capabilities.add("turn-output-tokens");
    capabilities.add("pricing-units");
  }
  return capabilities;
}

/**
 * Flatten one parsed session once. Raw inputs, outputs, commands, and paths are
 * consumed only while deriving hashes and fixed enums; none is retained.
 */
export async function buildReviewActions(
  session: Session,
  dataDir: string = defaultDataDir(),
): Promise<ReviewAction[]> {
  const actions: ReviewAction[] = [];
  for (const turn of session.turns) {
    if (turn.toolCalls.length === 0) {
      continue;
    }
    const priced = await priceSessionTurn(session, turn, dataDir);
    const completeUsd = priced && priced.unpricedUsage.total === 0 ? priced.usd : null;
    const share = 1 / turn.toolCalls.length;
    const attributedTokens = turn.usage ? scaleUsage(turn.usage, share) : emptyUsage();
    for (const call of turn.toolCalls) {
      const identityTool = sanitizeText(call.name).trim();
      const tool = boundedToolName(call.name);
      const canonicalInput = canonicalRecordedInput(call.input);
      const inputHash = canonicalInput === null ? undefined : hash(canonicalInput);
      const identityHash = identityTool && inputHash ? hash(identityTool + "\0" + inputHash) : undefined;
      const outcome = actionOutcome(call);
      const directWrite =
        DIRECT_WRITE_TOOLS.has(call.name) && outcome !== "error" && outcome !== "running";
      const rawPaths = pathsOf(call, directWrite);
      const keys = pathKeys(rawPaths);
      const check = validationKey(call, call.name);
      actions.push({
        index: actions.length,
        turnIndex: turn.index,
        tool,
        ...(identityHash ? { identityHash } : {}),
        ...(inputHash ? { inputHash } : {}),
        outcome,
        directWrite,
        sourceWrite: directWrite && rawPaths.some(isSourcePath),
        fileReadKeys: FILE_READ_TOOLS.has(call.name) ? keys : [],
        fileWriteKeys: directWrite ? keys : [],
        ...(check ? { validationKey: check } : {}),
        validationSuccess: check !== undefined && outcome === "ok",
        attributedTokens,
        attributedUsd: completeUsd === null ? null : completeUsd * share,
        durationMs:
          call.startedAt !== undefined && call.endedAt !== undefined
            ? Math.max(0, call.endedAt - call.startedAt)
            : null,
      });
    }
  }
  return actions;
}
