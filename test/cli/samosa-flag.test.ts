// SPEC-0070 R1 — the `--samosa` flag through the real option parser, the
// registered help text, and dispatch. Mirrors test/cli/share-flag.test.ts's
// shape. Unlike --share, --samosa has no requires-guard: it is an independent
// opt-in that turns the tip link back on for the comment + artifact.
import { describe, expect, it } from "vitest";
import { parseOptions } from "../../src/cli/options.js";
import { command as prCommand } from "../../src/cli/commands/pr.js";

describe("SPEC-0070 R1 --samosa CLI surface", () => {
  it("parses aireceipts pr --post --samosa", () => {
    const opts = parseOptions(["pr", "--post", "--samosa"]);
    expect(opts.positional).toEqual(["pr"]);
    expect(opts.samosa).toBe(true);
  });

  it("defaults to samosa=false (off by default — the tip link is opt-in)", () => {
    expect(parseOptions(["pr", "--post"]).samosa).toBe(false);
    expect(parseOptions(["pr", "--post", "--artifact"]).samosa).toBe(false);
  });

  it("lists --samosa in the pr command's help text", () => {
    expect(prCommand.help.lines.join("\n")).toContain("--samosa");
  });

  it("dispatch: --samosa never changes command selection (a pr flag, not a positional)", async () => {
    const { resolveCommand } = await import("../../src/cli/args.js");
    expect(await resolveCommand(["pr", "--post", "--samosa"])).toBe("pr");
  });
});
