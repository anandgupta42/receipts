// SPEC-0027 R4 + SPEC-0026 R5 — the `--artifact`/`--no-details` flags through
// the real option parser, registered help text, and main() dispatch
// (SPEC-0018 registry surface).
import { describe, expect, it } from "vitest";
import { parseOptions } from "../../src/cli/options.js";
import { command as prCommand } from "../../src/cli/commands/pr.js";
import { main } from "../../src/cli/index.js";

describe("SPEC-0027 R4 --artifact CLI surface", () => {
  it("parses aireceipts pr --post --artifact", () => {
    const opts = parseOptions(["pr", "--post", "--artifact"]);
    expect(opts.positional).toEqual(["pr"]);
    expect(opts.post).toBe(true);
    expect(opts.artifact).toBe(true);
  });

  it("defaults to artifact=false (opt-in, never implied)", () => {
    expect(parseOptions(["pr", "--post"]).artifact).toBe(false);
  });

  it("lists --artifact in the pr command's help text", () => {
    expect(prCommand.help.lines.join("\n")).toContain("--artifact");
  });

  it("parses and lists --no-details (SPEC-0026 R5)", () => {
    expect(parseOptions(["pr", "--no-details"]).noDetails).toBe(true);
    expect(parseOptions(["pr"]).noDetails).toBe(false);
    expect(prCommand.help.lines.join("\n")).toContain("--no-details");
  });

  it("dispatch: --no-details never changes command selection (a pr flag, not a positional)", async () => {
    const { resolveCommand } = await import("../../src/cli/args.js");
    expect(await resolveCommand(["pr", "--no-details"])).toBe("pr");
    expect(await resolveCommand(["pr", "--post", "--artifact", "--no-details"])).toBe("pr");
  });

  it("dispatches through main(): pr --artifact without --post exits 1 before rendering", async () => {
    const outWrites: string[] = [];
    const errWrites: string[] = [];
    const savedOut = process.stdout.write.bind(process.stdout);
    const savedErr = process.stderr.write.bind(process.stderr);
    const savedTelemetry = process.env.AIRECEIPTS_TELEMETRY;
    process.env.AIRECEIPTS_TELEMETRY = "off";
    process.stdout.write = ((s: string) => (outWrites.push(String(s)), true)) as typeof process.stdout.write;
    process.stderr.write = ((s: string) => (errWrites.push(String(s)), true)) as typeof process.stderr.write;
    try {
      const code = await main(["pr", "--artifact"]);
      expect(code).toBe(1);
      expect(errWrites.join("")).toContain("--artifact requires --post");
      expect(outWrites.join("")).toBe("");
    } finally {
      process.stdout.write = savedOut;
      process.stderr.write = savedErr;
      process.env.AIRECEIPTS_TELEMETRY = savedTelemetry;
    }
  });
});
