import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../../src/cli/index.js";

interface RunResult {
  code: number;
  out: string;
  err: string;
}

describe("SPEC-0043 R7 stats command", () => {
  let home: string;
  let savedHome: string | undefined;
  let savedTelemetry: string | undefined;
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "aireceipts-stats-"));
    savedHome = process.env.AIRECEIPTS_HOME;
    savedTelemetry = process.env.AIRECEIPTS_TELEMETRY;
    process.env.AIRECEIPTS_HOME = home;
    process.env.AIRECEIPTS_TELEMETRY = "off";
    origOut = process.stdout.write.bind(process.stdout);
    origErr = process.stderr.write.bind(process.stderr);
  });

  afterEach(() => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    if (savedHome === undefined) delete process.env.AIRECEIPTS_HOME;
    else process.env.AIRECEIPTS_HOME = savedHome;
    if (savedTelemetry === undefined) delete process.env.AIRECEIPTS_TELEMETRY;
    else process.env.AIRECEIPTS_TELEMETRY = savedTelemetry;
    rmSync(home, { recursive: true, force: true });
  });

  function seedState(state: unknown): void {
    mkdirSync(join(home, ".aireceipts"), { recursive: true });
    writeFileSync(join(home, ".aireceipts", "state.json"), typeof state === "string" ? state : JSON.stringify(state), "utf8");
    writeFileSync(join(home, ".aireceipts", "telemetry.json"), JSON.stringify({ shown: true }), "utf8");
  }

  async function run(argv: string[]): Promise<RunResult> {
    let out = "";
    let err = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      err += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    }) as typeof process.stderr.write;
    const code = await main(argv);
    return { code, out, err };
  }

  it("prints the exact four-line local counter copy", async () => {
    seedState({
      schemaVersion: 1,
      firstRunAt: "2026-07-01",
      runCount: 128,
      receiptCount: 42,
      milestones: {},
    });

    const result = await run(["stats"]);

    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out).toBe(
      [
        "receipts generated on this machine: 42",
        "total runs: 128",
        "first run: 2026-07-01",
        "(counted locally in ~/.aireceipts/state.json — delete that file to reset; never leaves your machine)",
        "",
      ].join("\n"),
    );
  });

  it("prints JSON with the same local counters", async () => {
    seedState({
      schemaVersion: 1,
      firstRunAt: "2026-07-01",
      runCount: 128,
      receiptCount: 42,
      milestones: {},
    });

    const result = await run(["stats", "--json"]);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({ receiptsGenerated: 42, totalRuns: 128, firstRunAt: "2026-07-01" });
  });

  it("works with telemetry off and corrupt state as zeros/unknown", async () => {
    seedState("{not json");

    const result = await run(["stats"]);

    expect(result.code).toBe(0);
    expect(result.out).toContain("receipts generated on this machine: 0\n");
    expect(result.out).toContain("total runs: 0\n");
    expect(result.out).toContain("first run: unknown\n");
  });
});
