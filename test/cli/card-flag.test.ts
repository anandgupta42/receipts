// SPEC-0077 R1/R4 — the `--card` flag through the real option parser and main()
// dispatch. The successful render (which would scan the machine's real session
// roots in-process) is owned by test/receipt/card.test.ts; this file owns the
// CLI seam: parsing, command selection, and the illegal-combination guards that
// fire before any session load.
import { describe, expect, it } from "vitest";
import { parseOptions } from "../../src/cli/options.js";
import { main } from "../../src/cli/index.js";

async function runMain(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const outWrites: string[] = [];
  const errWrites: string[] = [];
  const savedOut = process.stdout.write.bind(process.stdout);
  const savedErr = process.stderr.write.bind(process.stderr);
  const savedTelemetry = process.env.AIRECEIPTS_TELEMETRY;
  process.env.AIRECEIPTS_TELEMETRY = "off";
  process.stdout.write = ((s: string) => (outWrites.push(String(s)), true)) as typeof process.stdout.write;
  process.stderr.write = ((s: string) => (errWrites.push(String(s)), true)) as typeof process.stderr.write;
  try {
    const code = await main(argv);
    return { code, out: outWrites.join(""), err: errWrites.join("") };
  } finally {
    process.stdout.write = savedOut;
    process.stderr.write = savedErr;
    if (savedTelemetry === undefined) delete process.env.AIRECEIPTS_TELEMETRY;
    else process.env.AIRECEIPTS_TELEMETRY = savedTelemetry;
  }
}

describe("SPEC-0077 --card CLI surface", () => {
  it("parses --card, defaults false", () => {
    expect(parseOptions(["--card"]).card).toBe(true);
    expect(parseOptions([]).card).toBe(false);
  });

  it("never changes command selection (a render flag, not a positional)", async () => {
    const { resolveCommand } = await import("../../src/cli/args.js");
    expect(await resolveCommand(["--card"])).toBe("receipt");
    expect(await resolveCommand(["--card", "--svg"])).toBe("receipt");
  });

  it.each([
    ["--card --json", ["--card", "--json"], "--card cannot combine with --json"],
    ["--card --csv", ["--card", "--csv"], "--card cannot combine with --csv"],
    ["--card --svg --png", ["--card", "--svg", "--png"], "--card writes one file"],
    ["--card --by-project", ["--card", "--by-project"], "--card is always sanitized"],
  ])("R1/R4: %s exits 1 with a usage message, before any session load", async (_label, argv, needle) => {
    const { code, out, err } = await runMain(argv);
    expect(code).toBe(1);
    expect(err).toContain(needle);
    expect(out).toBe("");
  });
});

describe("SPEC-0077 R1/R2 — `pr --card` CLI surface (guards fire before the PR flow)", () => {
  it.each([
    ["pr --card (no number)", ["pr", "--card"], "needs the PR number"],
    ["pr --card --svg --png", ["pr", "189", "--card", "--svg", "--png"], "--card writes one file"],
    ["pr --card --by-project", ["pr", "189", "--card", "--by-project"], "--card is always sanitized"],
    ["pr --link (no --card)", ["pr", "189", "--link"], "--link only applies to pr --card"],
  ])("%s exits 1 with a usage message, before any session load", async (_label, argv, needle) => {
    const { code, out, err } = await runMain(argv);
    expect(code).toBe(1);
    expect(err).toContain(needle);
    expect(out).toBe("");
  });
});

describe("SPEC-0077 R4/R5 — `--link` parsing and session-card refusal", () => {
  it("parses --link, defaults false", () => {
    expect(parseOptions(["--link"]).link).toBe(true);
    expect(parseOptions([]).link).toBe(false);
  });

  it("R5: `--card --link` on the session (default) command is a usage error (session cards are image-only)", async () => {
    const { code, err, out } = await runMain(["--card", "--link"]);
    expect(code).toBe(1);
    expect(err).toContain("--link only applies to pr --card");
    expect(out).toBe("");
  });
});
