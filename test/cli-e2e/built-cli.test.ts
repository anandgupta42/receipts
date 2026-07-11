import { spawn, spawnSync } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { handoffJsonSchema, receiptJsonSchema, SCHEMA_VERSION } from "../../src/receipt/exportSchema.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturesDir = path.join(repoRoot, "test", "fixtures");
const cliPath = path.join(repoRoot, "dist", "cli.js");
const tempDirs: string[] = [];

// Probe whether THIS runtime loads node:sqlite unflagged (22.13+/23.4+, and
// not disabled via NODE_OPTIONS) by asking a child process that runs exactly
// like the spawned CLI does. Runtimes without it legitimately use the
// sqlite3-CLI fallback, so the in-process regression test below skips there
// instead of failing — a version gate would misclassify 23.0–23.3.
const hasNodeSqlite =
  spawnSync(process.execPath, ["-e", 'require("node:sqlite")'], { encoding: "utf8" }).status === 0;

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

interface CostEstimateJson {
  kind: "lower-bound";
  basis: "standard-api-list-price-equivalent";
  minUsd: number;
}

interface ReceiptJson {
  source: string;
  title: string | null;
  modelMix: Array<{ model: string }>;
  toolRows: ReceiptToolRowJson[];
  totalUsd: number | null;
  totalCostEstimate: CostEstimateJson | null;
  totalTokens: ReceiptTokenJson;
  sessionTotalTokens: ReceiptTokenJson;
  pricingCoverage: "full" | "partial" | "unpriced";
  unpricedTokens: ReceiptTokenJson;
  unpricedTokensScope: "parent-session";
  combinedUnpricedTokens: ReceiptTokenJson;
  combinedUnpricedTokensScope: "parent-session-plus-readable-subagents";
  combinedPricingCoverage: "full" | "partial" | "unpriced";
  combinedPricedUsd?: number | null;
  combinedTotalTokens?: number;
  subagents?: {
    count: number;
    pricedUsd: number | null;
    tokensTotal: number;
    unpricedTokens: ReceiptTokenJson;
    unpricedTokensScope: "readable-subagents";
  };
  caveats: Array<{ kind: string; text: string }>;
  priceRowsUsed: Array<{
    vendor: string;
    model: string;
    input_cache_write: number | null;
    context_tiers: Array<{ above_input_tokens: number; input: number; output: number }>;
  }>;
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
    pricingCoverage: "full" | "partial" | "unpriced";
    totalTokens: ReceiptTokenJson;
    parentUnpricedTokens: ReceiptTokenJson;
    combinedUnpricedTokens: ReceiptTokenJson;
    combinedTotalTokens?: number;
    subagentCount?: number;
    subagentUnpricedCount: number | null;
    subagentUnreadableCount: number | null;
    subagentRollupStatus: "complete" | "unavailable";
    costScope: string;
    tokenScope: string;
    totalScope?: string;
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
      // Node throws EINVAL spawning .cmd shims (npm.cmd) without a shell since
      // the CVE-2024-27980 hardening — windows-latest hits this in beforeAll.
      shell: command.endsWith(".cmd"),
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

async function stageClaudeSessionWithSubagents(home: string, fixtureName: string, destName: string): Promise<string> {
  const parent = await stageClaudeSession(home, fixtureName, destName);
  const sourceChildren = path.join(fixturesDir, "claude-code", "clean-with-subagents", "subagents");
  const destinationChildren = path.join(parent.replace(/\.jsonl$/u, ""), "subagents");
  await cp(sourceChildren, destinationChildren, { recursive: true });
  return parent;
}

async function stageCodexSession(home: string, fixtureName: string, destName = `rollout-${fixtureName}`): Promise<string> {
  const root = path.join(home, ".codex", "sessions", "2026", "06", "20");
  await mkdir(root, { recursive: true });
  const dest = path.join(root, destName);
  await copyFile(path.join(fixturesDir, "codex", fixtureName), dest);
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
    // SPEC-0055 (amended): the card carries no methodology footnote and no
    // samosa footer — the footer is the plain install CTA.
    expect(result.stdout).toContain("npx aireceipts-cli");
    expect(result.stdout).not.toContain("Per-turn cost split");
    expect(result.stdout).not.toContain("buy me a samosa");
  });

  it("prices Claude Code raw usage to an independent Standard-API floor oracle", async () => {
    const home = await makeHome();
    await stageClaudeSession(home, "clean-multi-tool-2-models.jsonl");

    const receipt = readJson<ReceiptJson>(await runCli(["--json"], home));

    expect(receipt.source).toBe("claude-code");
    expect(receipt.totalTokens).toMatchObject({
      input: 19680,
      output: 897,
      cacheRead: 124200,
      cacheCreation: 2100,
      total: 146877,
    });
    expect(receipt.sessionTotalTokens).toEqual(receipt.totalTokens);
    expect(receipt.totalUsd).toBeCloseTo(0.1767, 12);
    expect(receipt.totalCostEstimate).toEqual({
      kind: "lower-bound",
      basis: "standard-api-list-price-equivalent",
      minUsd: 0.1767,
    });
    expect(receipt.priceRowsUsed.map((row) => row.model).sort()).toEqual(["claude-opus-4-8", "claude-sonnet-5"]);
  });

  it("merges evolving Claude snapshots and duplicate tool ids through the built CLI", async () => {
    const home = await makeHome();
    await stageClaudeSession(home, "evolving-duplicate-snapshots.jsonl");

    const receipt = readJson<ReceiptJson>(await runCli(["--json"], home));
    expect(receipt.source).toBe("claude-code");
    expect(receipt.totalTokens).toMatchObject({
      input: 97,
      output: 53,
      cacheRead: 900,
      cacheCreation: 180,
      total: 1230,
    });
    expect(receipt.sessionTotalTokens).toEqual(receipt.totalTokens);
    const tools = toolRowsByName(receipt.toolRows);
    expect(tools.Bash.callCount).toBe(1);
    expect(tools.Read.callCount).toBe(1);
    expect(tools["(unattributed usage)"].tokens.total).toBe(10);
    expect(receipt.unpricedTokens?.total).toBe(10);
    expect(receipt.caveats).toContainEqual(
      expect.objectContaining({ kind: "unattributed-aggregate-usage", text: expect.stringContaining("trustworthy request/model join") }),
    );
    expect(receipt.totalCostEstimate?.kind).toBe("lower-bound");
  });

  it("prices Codex normalized cache usage to an independent Standard-API floor oracle", async () => {
    const home = await makeHome();
    await stageCodexSession(home, "clean-session.jsonl");

    const receipt = readJson<ReceiptJson>(await runCli(["--json"], home));

    expect(receipt.source).toBe("codex");
    expect(receipt.totalTokens).toMatchObject({
      input: 3700,
      output: 640,
      cacheRead: 6100,
      cacheCreation: 0,
      total: 10440,
    });
    expect(receipt.sessionTotalTokens).toEqual(receipt.totalTokens);
    expect(receipt.totalUsd).toBeCloseTo(0.0165025, 12);
    expect(receipt.totalCostEstimate?.kind).toBe("lower-bound");
    expect(receipt.totalCostEstimate?.minUsd).toBe(0.0165);
    expect(receipt.totalCostEstimate!.minUsd).toBeLessThanOrEqual(receipt.totalUsd!);
    expect(receipt.priceRowsUsed.map((row) => `${row.vendor}:${row.model}`)).toEqual(["openai:gpt-5.3-codex"]);
  });

  it("prices GPT-5.6 at and above 272K per request, exposing only a Standard-API lower bound", async () => {
    const home = await makeHome();
    await stageCodexSession(home, "gpt-5.6-context-tiers.jsonl");

    const receipt = readJson<ReceiptJson>(await runCli(["--json"], home));
    expect(receipt.source).toBe("codex");
    expect(receipt.totalTokens).toMatchObject({
      input: 400001,
      output: 4000,
      cacheRead: 544000,
      cacheCreation: 0,
      total: 948001,
    });
    // The first observable turn contains three requests: two 200K requests
    // (0.58 each) and one exactly at 272K (0.616). Its 672K aggregate must NOT
    // select the long tier. Only request 4 (272,001) uses that tier (1.21701).
    expect(receipt.totalUsd).toBeCloseTo(2.99301, 12);
    expect(receipt.totalCostEstimate).toEqual({
      kind: "lower-bound",
      basis: "standard-api-list-price-equivalent",
      minUsd: 2.993,
    });
    expect(receipt.caveats).toContainEqual(expect.objectContaining({
      kind: "unobserved-cache-write-tokens",
    }));
    expect(receipt.priceRowsUsed).toEqual([
      expect.objectContaining({
        vendor: "openai",
        model: "gpt-5.6-sol",
        input_cache_write: 6.25,
        context_tiers: [expect.objectContaining({ above_input_tokens: 272000, input: 10, output: 45 })],
      }),
    ]);

    const textReceipt = await runCli([], home);
    expectSuccess(textReceipt);
    expect(textReceipt.stdout).toMatch(/TOTAL\.+≥ \$2\.99/u);
    expect(textReceipt.stdout).toContain("standard API-equivalent floor; not an invoice");
    expect(textReceipt.stdout).toContain("Codex trace omits GPT-5.6 cache-write tokens");
  });

  // SPEC-0054 R9 e2e: `--details` through real argv parsing renders the
  // DETAILS section byte-identically to its committed golden; the R6 template
  // guard fires before any session work.
  it("renders the --details section from a sandboxed fixture home, matching the committed golden", async () => {
    const home = await makeHome();
    await stageClaudeSession(home, "clean-multi-tool-2-models.jsonl");

    const result = await runCli(["--details"], home);
    expectSuccess(result);
    const golden = await readFile(path.join(repoRoot, "goldens", "claude-code-clean-multi-tool-2-models-details.txt"), "utf8");
    expect(result.stdout).toBe(golden);

    const guarded = await runCli(["--details", "--template", "grocery"], home);
    expect(guarded.code).toBe(1);
    expect(guarded.stderr).toContain("--details supports the classic template only");

    const classic = await runCli(["--details", "--template", "classic"], home);
    expectSuccess(classic);
    expect(classic.stdout).toContain("DETAILS");
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
    expect(textResult.stdout).toContain("caveat: some observed cache tokens have no cited applicable rate");

    const receipt = readJson<ReceiptJson & { caveats: Array<{ kind: string; text: string }> }>(await runCli(["--json"], home));
    expect(receipt.caveats.some((c) => c.kind === "cost-lower-bound-cache-tier")).toBe(true);
    expect(receiptJsonSchema.safeParse(receipt).success).toBe(true);
  });

  it("SPEC-0044 A3 negative control: an Anthropic session (cited 5m/1h rates) renders NO caveat even with cache-write tokens (no false positive)", async () => {
    const home = await makeHome();
    await stageClaudeSession(home, "cache-tier-fallback-split.jsonl");

    const textResult = await runCli([], home);
    expectSuccess(textResult);
    expect(textResult.stdout).not.toContain("some observed cache tokens have no cited applicable rate");

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

  it("empty default receipt is human guidance, not a failure", async () => {
    const home = await makeHome();

    const result = await runCli([], home);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("no agent session data detected. Looked in:");
    expect(result.stdout).toContain("No sessions yet? Run `aireceipts --demo` to see a sample receipt.");
    expect(result.stdout).toContain(path.join(home, ".claude", "projects"));
    expect(result.stdout).toContain(path.join(home, ".codex", "sessions"));
  });

  it("empty mini receipt stays fail-safe and prints the guidance", async () => {
    const home = await makeHome();

    const result = await runCli(["--mini"], home);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("no agent session data detected. Looked in:");
    expect(result.stderr).toContain("No sessions yet? Run `aireceipts --demo` to see a sample receipt.");
  });

  it("empty machine receipt exports stay non-zero with no payload", async () => {
    const home = await makeHome();

    for (const args of [["--json"], ["--csv"], ["--csv=tool"]]) {
      const result = await runCli(args, home);

      expect(result.code, `${args.join(" ")} stderr:\n${result.stderr}`).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("no agent session data detected. Looked in:");
      expect(result.stderr).toContain("No sessions yet? Run `aireceipts --demo` to see a sample receipt.");
    }
  });

  it("SPEC v0.1.1: `--list --json` on zero sessions emits valid JSON `[]` on stdout, message on stderr", async () => {
    const home = await makeHome();

    const result = await runCli(["--list", "--json"], home);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([]);
    expect(result.stderr).toContain("no agent session data detected");
  });

  it("selector miss remains an error", async () => {
    const home = await makeHome();
    await stageClaudeSession(home, "clean-multi-tool-2-models.jsonl");

    const result = await runCli(["does-not-exist-xyz"], home);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe('no session matched "does-not-exist-xyz"\n');
  });

  it("selector miss on an empty machine prints searched roots and exits 1", async () => {
    const home = await makeHome();

    const result = await runCli(["does-not-exist-xyz"], home);

    expect(result.code, result.stderr).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("no agent session data detected. Looked in:");
    expect(result.stderr).toContain("No sessions yet? Run `aireceipts --demo` to see a sample receipt.");
    expect(result.stderr).toContain(path.join(home, ".claude", "projects"));
    expect(result.stderr).toContain(path.join(home, ".codex", "sessions"));
  });

  it("empty-machine handoff and mini selector paths print searched-root guidance", async () => {
    const cases: Array<{ args: string[]; expectedCode: number }> = [
      { args: ["--handoff", "does-not-exist-xyz"], expectedCode: 1 },
      { args: ["--mini", "does-not-exist-xyz"], expectedCode: 0 },
    ];
    for (const { args, expectedCode } of cases) {
      const home = await makeHome();

      const result = await runCli(args, home);

      expect(result.code, `${args.join(" ")} stderr:\n${result.stderr}`).toBe(expectedCode);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("no agent session data detected. Looked in:");
      expect(result.stderr).toContain("No sessions yet? Run `aireceipts --demo` to see a sample receipt.");
      expect(result.stderr).toContain(path.join(home, ".claude", "projects"));
      expect(result.stderr).toContain(path.join(home, ".codex", "sessions"));
    }
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

    const github = await runCli(["integrations", "github"], home);
    expectSuccess(github);
    expect(github.stdout).toContain("uses: anandgupta42/receipts/.github/workflows/pr-receipt-check.yml@latest");
    expect(github.stdout).toContain("ALTERNATIVE: self-contained npm-native pr-check");
    expect(github.stdout).toContain("npx -y aireceipts-cli@latest pr-check");

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
    expect(receipt.totalUsd).toBeCloseTo(0.00966875, 12);
    expect(receipt.totalCostEstimate?.kind).toBe("lower-bound");
    expect(receipt.totalCostEstimate?.minUsd).toBe(0.0096);
    expect(receipt.totalCostEstimate!.minUsd).toBeLessThanOrEqual(receipt.totalUsd!);
    expect(receipt.priceRowsUsed.map((row) => `${row.vendor}:${row.model}`).sort()).toEqual([
      "anthropic:claude-haiku-4-5",
      "openai:gpt-5.3-codex",
    ]);
    expect(receipt.modelMix.map((entry) => entry.model).sort()).toEqual(["claude-haiku-4-5", "gpt-5.3-codex"]);
    expect(tools.read.usd).toBeCloseTo(0.00301, 12);
    expect(tools.bash.usd).toBeCloseTo(0.00665875, 12);
  });

  it.skipIf(!hasNodeSqlite)("preserves OpenCode aggregate-only usage as an unpriced residual through the built CLI", async () => {
    const home = await makeHome();
    const dbPath = await stageOpenCodeDb(home, "clean-multi-vendor.db");
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath);
    db.prepare(`
      UPDATE session
      SET tokens_input = 2500, tokens_output = 700, tokens_reasoning = 100,
          tokens_cache_read = 200, tokens_cache_write = 120
      WHERE id = 'ses_clean'
    `).run();
    db.close();

    const receipt = readJson<ReceiptJson>(await runCli(["--json"], home));
    expect(receipt.totalTokens).toMatchObject({
      input: 2500,
      output: 800,
      cacheRead: 200,
      cacheCreation: 120,
      total: 3620,
    });
    expect(receipt.sessionTotalTokens).toEqual(receipt.totalTokens);
    expect(receipt.totalUsd).toBeCloseTo(0.00966875, 12);
    expect(receipt.caveats).toContainEqual(expect.objectContaining({ kind: "unattributed-aggregate-usage" }));
    const residual = receipt.toolRows.find((row) => row.tool === "(unattributed usage)");
    expect(residual).toMatchObject({ usd: null, tokens: { input: 300, output: 100, cacheRead: 50, cacheCreation: 30, total: 480 } });
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

  // Regression pair for tsup's removeNodeProtocol default: it rewrote
  // `import("node:sqlite")` to `import("sqlite")` in dist (ERR_MODULE_NOT_FOUND
  // at runtime), silently forcing every sqlite read onto a per-query
  // sqlite3-CLI spawn (~4x slower end-to-end on sqlite-heavy machines). Unit
  // tests import src and can never catch this — only the built artifact shows it.
  it("keeps the node:sqlite import specifier intact in the built artifact", async () => {
    const distFiles = await readdir(path.join(repoRoot, "dist"), { recursive: true });
    const sources = await Promise.all(
      distFiles
        .filter((file) => file.endsWith(".js"))
        .map((file) => readFile(path.join(repoRoot, "dist", file), "utf8")),
    );
    expect(sources.some((source) => /import\(["']node:sqlite["']\)/.test(source))).toBe(true);
    expect(sources.some((source) => /import\(["']sqlite["']\)/.test(source))).toBe(false);
  });

  it.skipIf(!hasNodeSqlite)("reads opencode sessions in-process with no sqlite3 binary on PATH", async () => {
    const home = await makeHome();
    await stageOpenCodeDb(home, "clean-multi-vendor.db");
    // An empty PATH dir makes the sqlite3-CLI fallback unreachable, so this
    // passes only when the built CLI's node:sqlite import actually resolves.
    const emptyPathDir = path.join(home, "empty-path-dir");
    await mkdir(emptyPathDir, { recursive: true });

    const listed = readJson<ListRowJson[]>(
      await runProcess(process.execPath, [cliPath, "--list", "--json"], {
        env: { ...cliEnv(home), PATH: emptyPathDir },
      }),
    );

    expect(listed).toHaveLength(1);
    expect(listed[0]?.source).toBe("opencode");
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
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(Object.keys(parsed).sort()).toEqual(["a", "b", "delta", "schemaVersion"]);
    expect(String(parsed.delta)).not.toMatch(/better|worse|winner|superior|inferior/i);
  });

  it("composes subagents across compare, setup latest, handoff, and benchmark full-session commands", async () => {
    const home = await makeHome();
    const cleanParent = await stageClaudeSessionWithSubagents(home, "clean-with-subagents.jsonl", "parent.jsonl");
    const loopParent = await stageClaudeSessionWithSubagents(home, "loop-bash-5x.jsonl", "loop-parent.jsonl");

    const compared = readJson<{ a: ReceiptJson; b: ReceiptJson }>(
      await runCli(["compare", cleanParent, loopParent, "--json"], home),
    );
    expect(compared.a.subagents?.count).toBe(2);
    expect(compared.b.subagents?.count).toBe(2);
    expect(compared.a.combinedPricedUsd).toBeGreaterThan(compared.a.totalUsd ?? 0);
    expect(compared.a.combinedTotalTokens).toBeGreaterThan(compared.a.totalTokens.total);
    expect(compared.a.subagents?.unpricedTokens.total).toBe(0);
    expect(compared.a.subagents?.unpricedTokensScope).toBe("readable-subagents");
    expect(compared.a.combinedUnpricedTokens.total).toBe(compared.a.unpricedTokens.total);
    expect(compared.a.combinedUnpricedTokensScope).toBe("parent-session-plus-readable-subagents");
    expect(compared.a.combinedPricingCoverage).toBe("full");
    expect(compared.b.combinedPricedUsd).toBeGreaterThan(compared.b.totalUsd ?? 0);

    const setup = readJson<SetupJson>(await runCli(["setup", "--json"], home));
    expect(setup.latest).toMatchObject({
      subagentCount: 2,
      subagentUnpricedCount: 0,
      subagentUnreadableCount: 0,
      subagentRollupStatus: "complete",
      pricingCoverage: "full",
      costScope: "parent-session-plus-readable-subagents",
      tokenScope: "parent-session-plus-readable-subagents",
      totalScope: "parent-session-plus-readable-subagents",
    });
    expect(setup.latest?.combinedUnpricedTokens.total).toBeGreaterThanOrEqual(setup.latest?.parentUnpricedTokens.total ?? 0);
    expect(setup.latest?.combinedTotalTokens).toBeGreaterThan(setup.latest?.totalTokens.total ?? 0);

    const handoff = await runCli(["--handoff", loopParent], home);
    expectSuccess(handoff);
    const expectedHandoffFloor = (Math.floor((compared.b.combinedPricedUsd as number) * 100 + 1e-9) / 100).toFixed(2);
    expect(handoff.stdout).toContain(`total ≥ $${expectedHandoffFloor}`);
    expect(handoff.stdout).toContain("2 subagents");
    expect(handoff.stdout).toContain("parent turns");
    expect(handoff.stdout.match(/2 subagents/gu)).toHaveLength(2);

    const benchmark = readJson<{ properties: { costPerTurnBucket: string; pricingCoverage: string } }>(
      await runCli(["benchmark", cleanParent, "--dry-run"], home),
    );
    expect(benchmark.properties.costPerTurnBucket).not.toBe("unpriced");
    expect(benchmark.properties.pricingCoverage).toBe("full");
  });

  it("SPEC-0042: --handoff --json emits the schema-valid resume packet; text form carries header + coverage", async () => {
    const home = await makeHome();
    await stageClaudeSession(home, "loop-bash-5x.jsonl", "loop.jsonl");

    const jsonRun = await runCli(["--handoff", "--json"], home);
    expect(jsonRun.code, jsonRun.stderr).toBe(0);
    const parsed = JSON.parse(jsonRun.stdout) as Record<string, unknown>;
    expect(() => handoffJsonSchema.parse(parsed)).not.toThrow();
    expect(parsed.coverage).toEqual({
      scope: "parent-session",
      turns: 6,
      toolCalls: 5,
      compactions: 0,
      wasteLines: 1,
    });
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(Object.keys(parsed)).toEqual([
      "schemaVersion",
      "source",
      "sessionId",
      "title",
      "startedAtMs",
      "durationMs",
      "totals",
      "pricingCoverage",
      "unpricedTokens",
      "unpricedTokensScope",
      "combinedUnpricedTokens",
      "combinedUnpricedTokensScope",
      "combinedPricingCoverage",
      "totalUsd",
      "totalCostEstimate",
      "totalUsdScope",
      "combinedPricedUsd",
      "combinedPricedCostEstimate",
      "combinedTotalTokens",
      "combinedScope",
      "subagents",
      "wasteLines",
      "wasteLinesScope",
      "couldHaveSaved",
      "suggestions",
      "threshold",
      "coverage",
      "aggregates",
    ]);
    expect(jsonRun.stdout).not.toMatch(/"(cwd|gitBranch|isSidechain|parentSessionId|agentId|parentFilePath)"/);

    const textRun = await runCli(["--handoff"], home);
    expect(textRun.code, textRun.stderr).toBe(0);
    expect(textRun.stdout).toContain("handoff: ");
    expect(textRun.stdout).toContain("total ≥ $");
    // SPEC-0059 R1/R3 — the slip headline and the class's rule line ride the packet.
    expect(textRun.stdout).toContain("FLAGGED PATTERN COST");
    expect(textRun.stdout).toContain("→ change or stop after two identical failures");
    expect(textRun.stdout).toContain("covers: 6 turns · 5 tool calls · 0 compactions · 1 flagged-pattern line");
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
    expect(result.stdout).toContain("[aireceipts]");
    expect(result.stdout).toContain("$0.17");
    expect(result.stdout).toContain("147k");
    expect(result.stdout.endsWith("\n")).toBe(true);
  });

  it("SPEC-0075 R2: sandbox-home statusline config changes the built CLI line", async () => {
    const home = await makeHome();
    await writeFile(path.join(home, ".aireceipts", "statusline.json"), JSON.stringify({ items: ["tokens"] }), "utf8");
    const transcriptPath = path.join(fixturesDir, "claude-code", "clean-multi-tool-2-models.jsonl");

    const result = await runCli(["statusline"], home, JSON.stringify({ transcript_path: transcriptPath }));

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("147k\n");
  });

  it("SPEC-0075 R2: corrupt sandbox-home config falls back with one stderr note", async () => {
    const home = await makeHome();
    await writeFile(path.join(home, ".aireceipts", "statusline.json"), "{bad json", "utf8");
    const transcriptPath = path.join(fixturesDir, "claude-code", "clean-multi-tool-2-models.jsonl");

    const result = await runCli(["statusline"], home, JSON.stringify({ transcript_path: transcriptPath }));

    expect(result.code).toBe(0);
    // SPEC-0076: default line now carries the dominant model between brand and cost.
    expect(result.stdout).toContain("[aireceipts] claude-opus-4-8 · ≥$0.17");
    expect(result.stderr).toBe("statusline.json ignored: statusline.json is not valid JSON\n");
  });

  it("scopes statusline disk discovery to --cwd instead of a newer foreign session", async () => {
    const home = await makeHome();
    const sessionCwd = "/home/dev/webapp";
    const projectsRoot = path.join(home, ".claude", "projects");
    // The literal encoded name, NOT encodeClaudeProjectCwd(sessionCwd): the
    // fixture layout must pin Claude Code's real on-disk convention, so an
    // encoder regression cannot silently reshape the fixture to keep matching.
    const projectDir = path.join(projectsRoot, "-home-dev-webapp");
    const foreignProjectDir = path.join(projectsRoot, "-home-dev-app5");
    await Promise.all([mkdir(projectDir, { recursive: true }), mkdir(foreignProjectDir, { recursive: true })]);
    const matchingPath = path.join(projectDir, "session.jsonl");
    const foreignPath = path.join(foreignProjectDir, "newer-foreign.jsonl");
    await copyFile(path.join(fixturesDir, "claude-code", "clean-multi-tool-2-models.jsonl"), matchingPath);
    await copyFile(path.join(fixturesDir, "claude-code", "trivial-spans-quick-qa.jsonl"), foreignPath);
    await utimes(matchingPath, 1_700_000_000, 1_700_000_000);
    await utimes(foreignPath, 1_700_000_100, 1_700_000_100);

    const result = await runCli(["statusline", "--cwd", `${sessionCwd}/src`], home);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("[aireceipts · Claude Code]");
    expect(result.stdout).toContain("147k");
  });

  it("fails fast when statusline --cwd has no value", async () => {
    const home = await makeHome();

    const result = await runCli(["statusline", "--cwd"], home);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("--cwd requires a non-empty path\n");
  });

  it("does not consume a following flag as the --cwd value", async () => {
    const home = await makeHome();

    const result = await runCli(["statusline", "--cwd", "--format", "brand"], home);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("--cwd requires a non-empty path\n");
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
    // A visibly floored `$` on TOTAL proves the installed package loaded its
    // price tables (rather than degrading to tokens-only mode).
    expect(run.stdout).toMatch(/TOTAL[.\s]*≥ \$\d/);
  });
}, 90_000);
