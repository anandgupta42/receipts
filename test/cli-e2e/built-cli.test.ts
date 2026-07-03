import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

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

async function stageClaudeSession(home: string, fixtureName: string, destName = fixtureName): Promise<string> {
  const root = path.join(home, ".claude", "projects");
  await mkdir(root, { recursive: true });
  const dest = path.join(root, destName);
  await copyFile(path.join(fixturesDir, "claude-code", fixtureName), dest);
  return dest;
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

  it("prints the no-session message with the searched sandbox roots and exit 0", async () => {
    const home = await makeHome();

    const result = await runCli(["--list"], home);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("no agent session data detected. Looked in:");
    expect(result.stdout).toContain(path.join(home, ".claude", "projects"));
    expect(result.stdout).toContain(path.join(home, ".codex", "sessions"));
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
      await readFile(path.join(installDir, "node_modules", "aireceipts", "package.json"), "utf8"),
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
  });
}, 90_000);
