// SPEC-0018 — the `--version`/`-v` flag through the real option parser,
// registered help text, and main() dispatch (SPEC-0018 registry surface).
// Mirrors test/cli/share-flag.test.ts's shape for the analogous guard.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseOptions } from "../../src/cli/options.js";
import { command as versionCommand } from "../../src/cli/commands/version.js";
import { getCliVersion } from "../../src/telemetry/helpers.js";
import { main } from "../../src/cli/index.js";

describe("SPEC-0018 --version/-v CLI surface", () => {
  it("parses --version", () => {
    expect(parseOptions(["--version"]).version).toBe(true);
  });

  it("parses -v", () => {
    expect(parseOptions(["-v"]).version).toBe(true);
  });

  it("defaults to version=false", () => {
    expect(parseOptions([]).version).toBe(false);
  });

  it("lists --version in the Usage help text", () => {
    expect(versionCommand.help.lines.join("\n")).toContain("--version");
  });

  it("dispatch: --version and -v both select the version command", async () => {
    const { resolveCommand } = await import("../../src/cli/args.js");
    expect(await resolveCommand(["--version"])).toBe("version");
    expect(await resolveCommand(["-v"])).toBe("version");
  });

  it("dispatches through main(): --version prints the package.json version + newline, exit 0", async () => {
    const outWrites: string[] = [];
    const errWrites: string[] = [];
    const savedOut = process.stdout.write.bind(process.stdout);
    const savedErr = process.stderr.write.bind(process.stderr);
    const savedTelemetry = process.env.AIRECEIPTS_TELEMETRY;
    const savedHome = process.env.AIRECEIPTS_HOME;
    // Isolated config dir with the first-run notice pre-marked shown — the
    // empty-stderr assertion below must not depend on the real HOME's state.
    const home = await mkdtemp(join(tmpdir(), "aireceipts-version-flag-"));
    await mkdir(join(home, ".aireceipts"), { recursive: true });
    await writeFile(join(home, ".aireceipts", "telemetry.json"), JSON.stringify({ shown: true }), "utf8");
    process.env.AIRECEIPTS_HOME = home;
    process.env.AIRECEIPTS_TELEMETRY = "off";
    process.stdout.write = ((s: string) => (outWrites.push(String(s)), true)) as typeof process.stdout.write;
    process.stderr.write = ((s: string) => (errWrites.push(String(s)), true)) as typeof process.stderr.write;
    try {
      const code = await main(["--version"]);
      expect(code).toBe(0);
      expect(errWrites.join("")).toBe("");
      expect(outWrites.join("")).toBe(`${getCliVersion()}\n`);
    } finally {
      process.stdout.write = savedOut;
      process.stderr.write = savedErr;
      process.env.AIRECEIPTS_TELEMETRY = savedTelemetry;
      if (savedHome === undefined) delete process.env.AIRECEIPTS_HOME;
      else process.env.AIRECEIPTS_HOME = savedHome;
      await rm(home, { recursive: true, force: true });
    }
  });
});
