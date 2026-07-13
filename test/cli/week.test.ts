// R7 CLI parsing for the `week` command and its flags. Kept additive: the
// existing receipt/list/compare/handoff parsing must be unaffected. SPEC-0018
// split parsing into command selection (`resolveCommand`) and the option bag
// (`parseOptions`); the assertions below track those two seams (the old
// `parseArgs` returned both in one struct).
import { describe, expect, it } from "vitest";
import { resolveCommand } from "../../src/cli/args.js";
import { parseOptions } from "../../src/cli/options.js";

describe("parse — week (R7)", () => {
  it("recognizes `week` as a subcommand", async () => {
    expect(await resolveCommand(["week"])).toBe("week");
    const o = parseOptions(["week"]);
    expect(o.byProject).toBe(false);
    expect(o.since).toBeUndefined();
    expect(o.json).toBe(false);
  });

  it("parses --json, --by-project together", async () => {
    expect(await resolveCommand(["week", "--json", "--by-project"])).toBe("week");
    const o = parseOptions(["week", "--json", "--by-project"]);
    expect(o.json).toBe(true);
    expect(o.byProject).toBe(true);
  });

  it("parses --since <date> as a two-token value", async () => {
    expect(await resolveCommand(["week", "--since", "2026-05-01"])).toBe("week");
    expect(parseOptions(["week", "--since", "2026-05-01"]).since).toBe("2026-05-01");
  });

  it("parses --since=<date> inline form", () => {
    const o = parseOptions(["week", "--since=2026-05-01", "--by-project"]);
    expect(o.since).toBe("2026-05-01");
    expect(o.byProject).toBe(true);
  });

  it("does not treat the --since value as a positional selector/subcommand", async () => {
    expect(await resolveCommand(["week", "--since", "compare"])).toBe("week");
    expect(parseOptions(["week", "--since", "compare"]).since).toBe("compare");
  });

  it("leaves other commands unaffected (default receipt, byProject defaults false)", async () => {
    expect(await resolveCommand([])).toBe("receipt");
    expect(parseOptions([]).byProject).toBe(false);
    expect(await resolveCommand(["compare", "1", "2"])).toBe("compare");
    expect(await resolveCommand(["--list"])).toBe("list");
  });
});

describe("parse — session review (SPEC-0083)", () => {
  it("selects the public command and maps the hidden alias to the same command", async () => {
    expect(await resolveCommand(["review"])).toBe("review");
    expect(await resolveCommand(["--handoff"])).toBe("review");
    expect(parseOptions(["review"]).reviewThreshold).toBeUndefined();
    expect(parseOptions(["--handoff"]).handoffThreshold).toBeUndefined();
  });

  it("parses the public threshold and both hidden alias forms into one value", () => {
    expect(parseOptions(["review", "--review-threshold", "6"]).reviewThreshold).toBe(6);
    expect(parseOptions(["--handoff", "--handoff-threshold", "5"]).handoffThreshold).toBe(5);
    expect(parseOptions(["--handoff", "--handoff-threshold=2"]).handoffThreshold).toBe(2);
  });

  it("carries a positional selector alongside the threshold", () => {
    const o = parseOptions(["--handoff", "abc123", "--handoff-threshold=4"]);
    expect(o.positional[0]).toBe("abc123");
    expect(o.handoffThreshold).toBe(4);
  });
});
