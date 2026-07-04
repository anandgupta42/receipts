// SPEC-0035 R5 — the `--share` flag through the real option parser,
// registered help text, and main() dispatch (SPEC-0018 registry surface).
// Mirrors test/cli/artifact-flag.test.ts's shape for the analogous guard.
import { describe, expect, it } from "vitest";
import { parseOptions } from "../../src/cli/options.js";
import { command as prCommand } from "../../src/cli/commands/pr.js";
import { main } from "../../src/cli/index.js";

describe("SPEC-0035 R5 --share CLI surface", () => {
  it("parses aireceipts pr --post --artifact --share", () => {
    const opts = parseOptions(["pr", "--post", "--artifact", "--share"]);
    expect(opts.positional).toEqual(["pr"]);
    expect(opts.artifact).toBe(true);
    expect(opts.share).toBe(true);
  });

  it("defaults to share=false (opt-in, never implied)", () => {
    expect(parseOptions(["pr", "--post", "--artifact"]).share).toBe(false);
  });

  it("lists --share in the pr command's help text", () => {
    expect(prCommand.help.lines.join("\n")).toContain("--share");
  });

  it("dispatch: --share never changes command selection (a pr flag, not a positional)", async () => {
    const { resolveCommand } = await import("../../src/cli/args.js");
    expect(await resolveCommand(["pr", "--post", "--artifact", "--share"])).toBe("pr");
  });

  it("dispatches through main(): pr --share without --artifact exits 1 before rendering", async () => {
    const outWrites: string[] = [];
    const errWrites: string[] = [];
    const savedOut = process.stdout.write.bind(process.stdout);
    const savedErr = process.stderr.write.bind(process.stderr);
    const savedTelemetry = process.env.AIRECEIPTS_TELEMETRY;
    process.env.AIRECEIPTS_TELEMETRY = "off";
    process.stdout.write = ((s: string) => (outWrites.push(String(s)), true)) as typeof process.stdout.write;
    process.stderr.write = ((s: string) => (errWrites.push(String(s)), true)) as typeof process.stderr.write;
    try {
      const code = await main(["pr", "--post", "--share"]);
      expect(code).toBe(1);
      expect(errWrites.join("")).toContain("--share requires --artifact");
      expect(outWrites.join("")).toBe("");
    } finally {
      process.stdout.write = savedOut;
      process.stderr.write = savedErr;
      process.env.AIRECEIPTS_TELEMETRY = savedTelemetry;
    }
  });
});
