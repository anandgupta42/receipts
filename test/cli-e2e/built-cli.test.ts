import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { handoffJsonSchema, receiptJsonSchema } from "../../src/receipt/exportSchema.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturesDir = path.join(repoRoot, "test", "fixtures");
const cliPath = path.join(repoRoot, "dist", "cli.js");
const tempDirs: string[] = [];

interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface ReceiptTokenJson {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  total: number;
}

interface ReceiptToolRowJson {
  tool: string;
  usd: number | null;
  tokens: ReceiptTokenJson;
  callCount: number;
}

interface ReceiptJson {
  source: string;
  title: string | null;
  modelMix: Array<{ model: string }>;
  toolRows: ReceiptToolRowJson[];
  totalUsd: number | null;
  totalTokens: ReceiptTokenJson;
  sessionTotalTokens: ReceiptTokenJson;
  priceRowsUsed: Array<{ vendor: string; model: string }>;
}

interface ListRowJson {
  source: string;
  title: string | null;
  model: string | null;
  totals: {
    tokens: ReceiptTokenJson;
    turnCount: number;
    toolCallCount: number;
  };
}

interface SetupJson {
  schemaVersion: number;
  status: "ready" | "no_sessions";
  agents: Array<{ source: string; label: string; sessionCount: number; tokenTotal: ReceiptTokenJson }>;
  latest: {
    source: string;
    label: string;
    model: string | null;
    totalUsd: number | null;
    totalTokens: ReceiptTokenJson;
    wasteLineCount: number;
  } | null;
  week: {
    sessionCount: number;
    pricedSessionCount: number;
    excludedSessionCount: number;
    pricedUsd: number | null;
    tokenTotal: ReceiptTokenJson;
  } | null;
  offers: Array<{ target: string; label: string; scope: string; network: string; start: string }>;
}

function platformCommand(name: string): string {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function runProcess(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.end(options.input ?? "");
  });
}

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function makeHome(): Promise<string> {
  const home = await makeTempDir("aireceipts-home-");
  await mkdir(path.join(home, ".aireceipts"), { recursive: true });
  await writeFile(path.join(home, ".aireceipts", "telemetry.json"), '{"shown":true}', "utf8");
  return home;
}

function cliEnv(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    AIRECEIPTS_HOME: home,
    AIRECEIPTS_TELEMETRY: "off",
    AIRECEIPTS_TELEMETRY_CONNECTION: "",
    DO_NOT_TRACK: "1",
    NO_COLOR: "1",
  };
}

function npmEnv(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    USERPROFILE: home,
    npm_config_cache: path.join(home, ".npm"),
    npm_config_logs_dir: path.join(home, "_logs"),
  };
}

function runCli(args: string[], home: string, input?: string): Promise<RunResult> {
  return runProcess(process.execPath, [cliPath, ...args], { env: cliEnv(home), input });
}

function expectSuccess(result: RunResult): void {
  expect(result.code, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
}

function readJson<T>(result: RunResult): T {
  expectSuccess(result);
  return JSON.parse(result.stdout) as T;
}

async function stageClaudeSession(home: string, fixtureName: string, destName = fixtureName): Promise<string> {
  const root = path.join(home, ".claude", "projects");
  await mkdir(root, { recursive: true });
  const dest = path.join(root, destName);
  await copyFile(path.join(fixturesDir, "claude-code", fixtureName), dest);
  return dest;
}

function opencodeRoot(home: string): string {
  if (process.platform === "win32") {
    return path.join(home, "AppData", "Local", "opencode");
  }
  return path.join(home, ".local", "share", "opencode");
}

async function stageOpenCodeDb(home: string, fixtureName: string): Promise<string> {
  const root = opencodeRoot(home);
  await mkdir(root, { recursive: true });
  const dest = path.join(root, "opencode.db");
  await copyFile(path.join(fixturesDir, "opencode", fixtureName), dest);
  return dest;
}

function toolRowsByName(rows: ReceiptToolRowJson[]): Record<string, ReceiptToolRowJson> {
  return Object.fromEntries(rows.map((row) => [row.tool, row])) as Record<string, ReceiptToolRowJson>;
}

/** Is this platform-specific package installable HERE? Passing an incompatible one
 * to `npm install` makes it a direct dep and EBADPLATFORMs the whole install (CI keeps
 * both musl and glibc variants in node_modules; only one fits the runner). */
async function platformCompatible(pkgDir: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await readFile(path.join(pkgDir, "package.json"), "utf8")) as {
      os?: string[]; cpu?: string[]; libc?: string[];
    };
    if (pkg.os && !pkg.os.includes(process.platform)) return false;
    if (pkg.cpu && !pkg.cpu.includes(process.arch)) return false;
    if (pkg.libc && process.platform === "linux") {
      const isMusl = process.report?.getReport !== undefined &&
        !(process.report.getReport() as { header?: { glibcVersionRuntime?: string } }).header?.glibcVersionRuntime;
      if (!pkg.libc.includes(isMusl ? "musl" : "glibc")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function localRuntimePackageDirs(): Promise<string[]> {
  const resvgScope = path.join(repoRoot, "node_modules", "@resvg");
  const resvgPackages = await readdir(resvgScope, { withFileTypes: true }).catch(() => []);
  const platformDirs: string[] = [];
  for (const entry of resvgPackages) {
    if (!entry.isDirectory() || !entry.name.startsWith("resvg-js-")) continue;
    const dir = path.join(resvgScope, entry.name);
    if (await platformCompatible(dir)) platformDirs.push(dir);
  }
  return [path.join(repoRoot, "node_modules", "zod"), path.join(resvgScope, "resvg-js"), ...platformDirs];
}

beforeAll(async () => {
  const result = await runProcess(platformCommand("npm"), ["run", "build"]);
  expect(result.code, result.stdout + result.stderr).toBe(0);
}, 60_000);

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("built CLI e2e", () => {
  it("renders the default receipt from a sandboxed fixture home", async () => {
    const home = await makeHome();
    await stageClaudeSession(home, "clean-multi-tool-2-models.jsonl");

    const result = await runCli([], home);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("AIRECEIPTS");
    expect(result.stdout).toContain("Claude Code");
    expect(result.stdout).toContain("TOTAL");
    expect(result.stdout).toContain("Per-turn cost split");
  });

  // SPEC-0044 A3 (e2e through the real built CLI, not just runPr): the caveat
  // is row-aware, not usage-only — it fires only when the vendor's price row
  // doesn't cite a cache-write rate, so the fallback to base `input` actually
  // understates cost. `cache-tier-fallback-unsplit.jsonl` uses an openai model
  // (no `input_cache_write_5m`/`1h` cited in data/prices/openai.json), so its
  // unsplit cache-write falls back to the base rate — genuine lower bound.
  // `cache-tier-fallback-split.jsonl` uses an Anthropic model whose row cites
  // both TTL tiers, so it prices exactly — no caveat — the negative control.
  // (test/fixtures/claude-code/cache-tier-fallback-*.jsonl; through the actual
  // dist/cli.js binary: parse → attributeByTool → buildReceiptModel → render.)
  it("SPEC-0044 A3: an unsplit cache-write session on a vendor with no cited cache-write rate renders the lower-bound caveat on the text receipt and the schema-valid `--json` export", async () => {
    const home = await makeHome();
    await stageClaudeSession(home, "cache-tier-fallback-unsplit.jsonl");

    const textResult = await runCli([], home);
    expectSuccess(textResult);
    expect(textResult.stdout).toContain("caveat: cache-write cost is a lower bound for this session");

    const receipt = readJson<ReceiptJson & { caveats: Array<{ kind: string; text: string }> }>(await runCli(["--json"], home));
    expect(receipt.caveats.some((c) => c.kind === "cost-lower-bound-cache-tier")).toBe(true);
    expect(receiptJsonSchema.safeParse(receipt).success).toBe(true);
  });

  it("SPEC-0044 A3 negative control: an Anthropic session (cited 5m/1h rates) renders NO caveat even with cache-write tokens (no false positive)", async () => {
    const home = await makeHome();
    await stageClaudeSession(home, "cache-tier-fallback-split.jsonl");

    const textResult = await runCli([], home);
    expectSuccess(textResult);
    expect(textResult.stdout).not.toContain("cache-write cost is a lower bound");

    const receipt = readJson<ReceiptJson & { caveats: Array<{ kind: string; text: string }> }>(await runCli(["--json"], home));
    expect(receipt.caveats.some((c) => c.kind === "cost-lower-bound-cache-tier")).toBe(false);
  });

  it("prints the no-session message with the searched sandbox roots and exit 0", async () => {
    const home = await makeHome();

    const result = await runCli(["--list"], home);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("no agent session data detected. Looked in:");
    expect(result.stdout).toContain(path.join(home, ".claude", "projects"));
    expect(result.stdout).toContain(path.join(home, ".codex", "sessions"));
  });

  it("SPEC v0.1.1: `--list --json` on zero sessions emits valid JSON `[]` on stdout, message on stderr", async () => {
    const home = await makeHome();

    const result = await runCli(["--list", "--json"], home);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([]);
    expect(result.stderr).toContain("no agent session data detected");
  });

  it("runs setup with no sessions and exits 0 after printing searched roots", async () => {
    const home = await makeHome();

    const result = await runCli(["setup"], home);

    expectSuccess(result);
    expect(result.stdout).toContain("AIRECEIPTS SETUP");
    expect(result.stdout).toContain("no agent session data detected. Looked in:");
    expect(result.stdout).toContain(path.join(home, ".claude", "projects"));
    expect(result.stdout).toContain("npx aireceipts-cli integrations");
  });

  it("runs setup JSON against a fixture session without leaking paths or titles", async () => {
    const home = await makeHome();
    await stageClaudeSession(home, "clean-multi-tool-2-models.jsonl");

    const text = await runCli(["setup"], home);
    expectSuccess(text);
    expect(text.stdout).toContain("Latest session");
    expect(text.stdout).toContain("Claude Code");
    expect(text.stdout).toContain("Trailing 7 days");
    expect(text.stdout.indexOf("Latest session")).toBeLessThan(text.stdout.indexOf("Next"));

    const parsed = readJson<SetupJson>(await runCli(["setup", "--json"], home));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.status).toBe("ready");
    expect(parsed.latest).toMatchObject({ source: "claude-code", label: "Claude Code", model: "claude-opus-4-8" });
    expect(parsed.latest?.totalUsd).toBeGreaterThan(0);
    expect(parsed.offers.map((offer) => offer.target)).toEqual(["claude-code", "codex", "opencode", "cursor", "github"]);
    expect(JSON.stringify(parsed)).not.toContain(home);
    expect(JSON.stringify(parsed)).not.toContain("clean-multi-tool-2-models");
    expect(JSON.stringify(parsed)).not.toContain("Add email format validation");
  });

  it("prints integration matrix, target recipe, and unknown-target errors", async () => {
    const home = await makeHome();

    const matrix = await runCli(["integrations"], home);
    expectSuccess(matrix);
    expect(matrix.stdout).toContain("AIRECEIPTS INTEGRATIONS");
    expect(matrix.stdout).toContain("claude-code");
    expect(matrix.stdout).toContain("opencode");

    const opencode = await runCli(["integrations", "opencode"], home);
    expectSuccess(opencode);
    expect(opencode.stdout).toContain(".opencode/commands/receipt.md");
    expect(opencode.stdout).toContain("npx aireceipts-cli pr --post");

    const unknown = await runCli(["integrations", "unknown"], home);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('unknown integration target "unknown"');
  });

  it("discovers and prices opencode multi-provider sessions through built CLI", async () => {
    const home = await makeHome();
    await stageOpenCodeDb(home, "clean-multi-vendor.db");

    const listed = readJson<ListRowJson[]>(await runCli(["--list", "--json"], home));

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      source: "opencode",
      title: "Port parser adapter",
      model: "claude-haiku-4-5",
      totals: {
        turnCount: 2,
        toolCallCount: 2,
      },
    });
    expect(listed[0].totals.tokens).toMatchObject({ input: 2200, output: 700, cacheRead: 150, cacheCreation: 90, total: 3140 });

    const receipt = readJson<ReceiptJson>(await runCli(["--json"], home));
    const tools = toolRowsByName(receipt.toolRows);

    expect(receipt.source).toBe("opencode");
    expect(receipt.title).toBe("Port parser adapter");
    expect(receipt.totalTokens.total).toBe(3140);
    expect(receipt.sessionTotalTokens.total).toBe(3140);
    expect(receipt.totalUsd).toBeCloseTo(0.00975625, 12);
    expect(receipt.priceRowsUsed.map((row) => `${row.vendor}:${row.model}`).sort()).toEqual([
      "anthropic:claude-haiku-4-5",
      "openai:gpt-5.3-codex",
    ]);
    expect(receipt.modelMix.map((entry) => entry.model).sort()).toEqual(["claude-haiku-4-5", "gpt-5.3-codex"]);
    expect(tools.read.usd).toBeCloseTo(0.00301, 12);
    expect(tools.bash.usd).toBeCloseTo(0.00674625, 12);
  });

  it("partially prices opencode sessions when only some provider models are known", async () => {
    const home = await makeHome();
    await stageOpenCodeDb(home, "mixed-known-unknown.db");

    const receipt = readJson<ReceiptJson>(await runCli(["--json"], home));
    const tools = toolRowsByName(receipt.toolRows);

    expect(receipt.source).toBe("opencode");
    expect(receipt.title).toBe("Mixed known and unknown provider");
    expect(receipt.totalTokens.total).toBe(3140);
    expect(receipt.totalUsd).toBeCloseTo(0.00301, 12);
    expect(receipt.priceRowsUsed.map((row) => `${row.vendor}:${row.model}`)).toEqual(["anthropic:claude-haiku-4-5"]);
    expect(receipt.modelMix.map((entry) => entry.model).sort()).toEqual(["claude-haiku-4-5", "local-big-pickle"]);
    expect(tools.read.usd).toBeCloseTo(0.00301, 12);
    expect(tools.bash.usd).toBeNull();
    expect(tools.bash.tokens.total).toBe(1450);
  });

  it("keeps unknown opencode provider sessions tokens-only through built CLI", async () => {
    const home = await makeHome();
    await stageOpenCodeDb(home, "legacy-empty-session-message.db");

    const receipt = readJson<ReceiptJson>(await runCli(["--json"], home));

    expect(receipt.source).toBe("opencode");
    expect(receipt.title).toBe("Legacy rows with empty session_message");
    expect(receipt.totalUsd).toBeNull();
    expect(receipt.priceRowsUsed).toEqual([]);
    expect(receipt.totalTokens.total).toBe(36328);
    expect(receipt.toolRows.every((row) => row.usd === null)).toBe(true);
    expect(receipt.toolRows.map((row) => row.tool).sort()).toEqual(["(thinking/reply)", "bash", "write"]);

    const textResult = await runCli([], home);

    expectSuccess(textResult);
    expect(textResult.stdout).toContain("no price table matched");
    expect(textResult.stdout).not.toContain("$");
  });

  it("keeps output flag precedence stable: SVG beats CSV/JSON, and CSV beats JSON", async () => {
    const home = await makeHome();
    await stageClaudeSession(home, "clean-multi-tool-2-models.jsonl");
    const svgPath = path.join(home, "receipt.svg");

    const svgResult = await runCli(["--json", "--csv=tool", "--svg", "-o", svgPath], home);

    expect(svgResult.code, svgResult.stderr).toBe(0);
    expect(svgResult.stderr).toBe("");
    expect(svgResult.stdout).toMatch(/^wrote .+receipt\.svg \(\d+ bytes\)\n$/);
    expect(svgResult.stdout).not.toContain("schemaVersion,sessionId");
    expect(svgResult.stdout.trim()).not.toMatch(/^\{/);
    expect(await readFile(svgPath, "utf8")).toContain("<svg");

    const csvResult = await runCli(["--json", "--csv=tool"], home);

    expect(csvResult.code, csvResult.stderr).toBe(0);
    expect(csvResult.stderr).toBe("");
    expect(csvResult.stdout).toContain("schemaVersion,sessionId,agent,tool,usd");
    expect(csvResult.stdout.trim()).not.toMatch(/^\{/);
  });

  it("compares two fixture sessions through built CLI dispatch", async () => {
    const home = await makeHome();
    const clean = await stageClaudeSession(home, "clean-multi-tool-2-models.jsonl", "clean.jsonl");
    const loop = await stageClaudeSession(home, "loop-bash-5x.jsonl", "loop.jsonl");

    const result = await runCli(["compare", clean, loop, "--json"], home);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(parsed.schemaVersion).toBe(1);
    expect(Object.keys(parsed).sort()).toEqual(["a", "b", "delta", "schemaVersion"]);
    expect(String(parsed.delta)).not.toMatch(/better|worse|winner|superior|inferior/i);
  });

  it("SPEC-0042: --handoff --json emits the schema-valid resume packet; text form carries header + coverage", async () => {
    const home = await makeHome();
    await stageClaudeSession(home, "loop-bash-5x.jsonl", "loop.jsonl");

    const jsonRun = await runCli(["--handoff", "--json"], home);
    expect(jsonRun.code, jsonRun.stderr).toBe(0);
    const parsed = JSON.parse(jsonRun.stdout) as Record<string, unknown>;
    expect(() => handoffJsonSchema.parse(parsed)).not.toThrow();
    expect(parsed.coverage).toEqual({ turns: 6, toolCalls: 5, compactions: 0, wasteLines: 1 });
    expect(parsed.schemaVersion).toBe(1);
    expect(Object.keys(parsed)).toEqual([
      "schemaVersion",
      "source",
      "sessionId",
      "title",
      "startedAtMs",
      "durationMs",
      "totals",
      "wasteLines",
      "suggestions",
      "threshold",
      "coverage",
      "aggregates",
    ]);
    expect(jsonRun.stdout).not.toMatch(/"(cwd|gitBranch|isSidechain|parentSessionId|agentId|parentFilePath)"/);

    const textRun = await runCli(["--handoff"], home);
    expect(textRun.code, textRun.stderr).toBe(0);
    expect(textRun.stdout).toContain("handoff: ");
    expect(textRun.stdout).toContain("total $");
    expect(textRun.stdout).toContain("covers: 6 turns · 5 tool calls · 0 compactions · 1 waste lines");
  });

  it("treats malformed budget config as stderr-only advisory and still renders the receipt", async () => {
    const home = await makeHome();
    await stageClaudeSession(home, "clean-multi-tool-2-models.jsonl");
    await writeFile(path.join(home, ".aireceipts", "budget.json"), "{bad json", "utf8");

    const result = await runCli([], home);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("AIRECEIPTS");
    expect(result.stdout).toContain("TOTAL");
    expect(result.stderr).toBe("budget.json ignored: budget.json is not valid JSON\n");
  });

  it("renders statusline from stdin transcript_path without scanning disk sessions", async () => {
    const home = await makeHome();
    const transcriptPath = path.join(fixturesDir, "claude-code", "clean-multi-tool-2-models.jsonl");
    const input = JSON.stringify({ transcript_path: transcriptPath, cwd: "/ignored" });

    const result = await runCli(["statusline"], home, input);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("[Claude Code]");
    expect(result.stdout).toContain("$0.18");
    expect(result.stdout).toContain("147k tok");
    expect(result.stdout.endsWith("\n")).toBe(true);
  });

  it("statusline falls back to the neutral empty state for malformed stdin and no fixture home", async () => {
    const home = await makeHome();

    const result = await runCli(["statusline"], home, "{not json");

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("aireceipts: no sessions detected\n");
  });
});

describe("packed tarball smoke", () => {
  it("installs npm pack output and runs the package bin against a fixture", async () => {
    const packDir = await makeTempDir("aireceipts-pack-");
    const installDir = await makeTempDir("aireceipts-install-");
    const npmHome = await makeTempDir("aireceipts-npm-");
    const home = await makeHome();
    await stageClaudeSession(home, "clean-multi-tool-2-models.jsonl");

    const pack = await runProcess(platformCommand("npm"), ["pack", "--pack-destination", packDir, "--json"], {
      env: npmEnv(npmHome),
    });
    expect(pack.code, pack.stdout + pack.stderr).toBe(0);
    const [packed] = JSON.parse(pack.stdout) as Array<{ filename: string; files: Array<{ path: string }> }>;
    expect(packed.files.some((file) => file.path === "dist/cli.js")).toBe(true);
    expect(packed.files.some((file) => file.path === "data/prices/anthropic.json")).toBe(true);

    await writeFile(path.join(installDir, "package.json"), '{"private":true}\n', "utf8");
    const tarball = await realpath(path.join(packDir, packed.filename));
    const install = await runProcess(
      platformCommand("npm"),
      ["install", tarball, ...(await localRuntimePackageDirs()), "--offline", "--no-audit", "--no-fund"],
      { cwd: installDir, env: npmEnv(npmHome) },
    );
    expect(install.code, install.stdout + install.stderr).toBe(0);

    const installedPackage = JSON.parse(
      await readFile(path.join(installDir, "node_modules", "aireceipts-cli", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(installedPackage.dependencies).toHaveProperty("zod");
    expect(installedPackage.dependencies).toHaveProperty("@resvg/resvg-js");

    const bin = path.join(installDir, "node_modules", ".bin", platformCommand("aireceipts"));
    const run = await runProcess(bin, [], { cwd: installDir, env: cliEnv(home) });

    expect(run.code, run.stderr).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout).toContain("AIRECEIPTS");
    expect(run.stdout).toContain("Claude Code");
    expect(run.stdout).toContain("TOTAL");
    // The fixture is a priced session: a `$` on the TOTAL line proves the
    // installed package loaded its data/prices tables (not a tokens-only fall).
    expect(run.stdout).toMatch(/TOTAL[.\s]*\$\d/);
  });
}, 90_000);
