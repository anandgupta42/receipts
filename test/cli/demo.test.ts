// SPEC-0051 — `--demo` renders the bundled sample receipt through the real
// pipeline: stdout byte-identical to the README-hero golden (colour off),
// banner on stderr, and the shipped fixture pinned to its source (no drift).
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseOptions } from "../../src/cli/options.js";
import { command as demoCommand } from "../../src/cli/commands/demo.js";
import { toCommandTelemetry } from "../../src/telemetry/helpers.js";
import { COMMAND_VALUES } from "../../src/telemetry/schemas.js";
import { main } from "../../src/cli/index.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../..");
const GOLDEN = readFileSync(join(repoRoot, "goldens/claude-code-clean-multi-tool-2-models.txt"), "utf8");
const BANNER_HEAD = "demo · a sample session bundled with aireceipts";

function restoreEnv(key: string, saved: string | undefined): void {
  if (saved === undefined) delete process.env[key];
  else process.env[key] = saved;
}

async function isolatedHome(prefix: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(home, ".aireceipts"), { recursive: true });
  // Pre-mark the first-run notice shown so it never pollutes stderr.
  await writeFile(join(home, ".aireceipts", "telemetry.json"), JSON.stringify({ shown: true }), "utf8");
  return home;
}

describe("SPEC-0051 --demo", () => {
  it("R1: parses --demo, defaults false", () => {
    expect(parseOptions(["--demo"]).demo).toBe(true);
    expect(parseOptions([]).demo).toBe(false);
  });

  it("R5: lists --demo in the Usage help text", () => {
    expect(demoCommand.help?.lines.join("\n")).toContain("--demo");
  });

  it("dispatch: --demo selects the demo command", async () => {
    const { resolveCommand } = await import("../../src/cli/args.js");
    expect(await resolveCommand(["--demo"])).toBe("demo");
  });

  it("priority: --telemetry-show --demo still takes the telemetry-show path (no record)", async () => {
    const { resolveCommand } = await import("../../src/cli/args.js");
    expect(await resolveCommand(["--telemetry-show", "--demo"])).toBe("telemetry-show");
  });

  it("R4: demo is a telemetry command value and maps to itself", () => {
    expect((COMMAND_VALUES as readonly string[]).includes("demo")).toBe(true);
    expect(toCommandTelemetry("demo")).toBe("demo");
  });

  it("R2: shipped demo fixture is byte-identical to its source (no drift)", async () => {
    const shipped = await readFile(join(repoRoot, "data/demo/clean-multi-tool-2-models.jsonl"));
    const source = await readFile(join(repoRoot, "test/fixtures/claude-code/clean-multi-tool-2-models.jsonl"));
    expect(shipped.equals(source)).toBe(true);
  });

  it("R1/R2: main(['--demo']) writes the golden receipt to stdout and the banner to stderr, exit 0", async () => {
    const outWrites: string[] = [];
    const errWrites: string[] = [];
    const savedOut = process.stdout.write.bind(process.stdout);
    const savedErr = process.stderr.write.bind(process.stderr);
    const savedHome = process.env.AIRECEIPTS_HOME;
    const savedTelemetry = process.env.AIRECEIPTS_TELEMETRY;
    const savedNoColor = process.env.NO_COLOR;
    const home = await isolatedHome("aireceipts-demo-");
    process.env.AIRECEIPTS_HOME = home;
    process.env.AIRECEIPTS_TELEMETRY = "off";
    process.env.NO_COLOR = "1";
    process.stdout.write = ((s: string) => (outWrites.push(String(s)), true)) as typeof process.stdout.write;
    process.stderr.write = ((s: string) => (errWrites.push(String(s)), true)) as typeof process.stderr.write;
    try {
      const code = await main(["--demo"]);
      expect(code).toBe(0);
      expect(outWrites.join("")).toBe(GOLDEN);
      expect(errWrites.join("")).toContain(BANNER_HEAD);
      // stdout is a pure receipt — no ANSI escapes with colour off.
      expect(outWrites.join("")).not.toMatch(/\[/u);
    } finally {
      process.stdout.write = savedOut;
      process.stderr.write = savedErr;
      restoreEnv("AIRECEIPTS_HOME", savedHome);
      restoreEnv("AIRECEIPTS_TELEMETRY", savedTelemetry);
      restoreEnv("NO_COLOR", savedNoColor);
      await rm(home, { recursive: true, force: true });
    }
  });

  it("R3: both empty-state messages point to --demo", async () => {
    // noSessionsMessage appends the pointer on both branches ("no agent session
    // data detected …" when no roots exist, "no sessions found" otherwise), so
    // whichever fires on the runner, the pointer is present.
    const { noSessionsMessage } = await import("../../src/cli/common/session.js");
    const msg = await noSessionsMessage();
    expect(msg).toContain("`aireceipts --demo`");
    expect(msg).toMatch(/no agent session data detected|no sessions found/u);
  });
});
