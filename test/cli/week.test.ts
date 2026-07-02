// R7 CLI parsing for the `week` command and its flags. Kept additive: the
// existing receipt/list/compare/handoff parsing must be unaffected.
import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/cli/args.js";

describe("parseArgs — week (R7)", () => {
  it("recognizes `week` as a subcommand", () => {
    const a = parseArgs(["week"]);
    expect(a.command).toBe("week");
    expect(a.byProject).toBe(false);
    expect(a.since).toBeUndefined();
    expect(a.json).toBe(false);
  });

  it("parses --json, --by-project together", () => {
    const a = parseArgs(["week", "--json", "--by-project"]);
    expect(a.command).toBe("week");
    expect(a.json).toBe(true);
    expect(a.byProject).toBe(true);
  });

  it("parses --since <date> as a two-token value", () => {
    const a = parseArgs(["week", "--since", "2026-05-01"]);
    expect(a.command).toBe("week");
    expect(a.since).toBe("2026-05-01");
  });

  it("parses --since=<date> inline form", () => {
    const a = parseArgs(["week", "--since=2026-05-01", "--by-project"]);
    expect(a.since).toBe("2026-05-01");
    expect(a.byProject).toBe(true);
  });

  it("does not treat the --since value as a positional selector/subcommand", () => {
    const a = parseArgs(["week", "--since", "compare"]);
    expect(a.command).toBe("week");
    expect(a.since).toBe("compare");
  });

  it("leaves other commands unaffected (default receipt, byProject defaults false)", () => {
    expect(parseArgs([]).command).toBe("receipt");
    expect(parseArgs([]).byProject).toBe(false);
    expect(parseArgs(["compare", "1", "2"]).command).toBe("compare");
    expect(parseArgs(["--list"]).command).toBe("list");
  });
});
