// SPEC-0054 R6/R7/R8 — the `--details` flag through the real option parser,
// the classic-only template guard through main() dispatch, and the
// `detailsView` boolean on the shared receipt-telemetry builder. The rendered
// DETAILS section itself is pinned by `test/receipt/details.test.ts` and the
// R9 goldens; this file owns the CLI seam.
import { describe, expect, it } from "vitest";
import { parseOptions } from "../../src/cli/options.js";
import { receiptTelemetryFromModels } from "../../src/cli/common/telemetry.js";
import { validateEvent } from "../../src/telemetry/schemas.js";
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

describe("SPEC-0054 --details CLI surface", () => {
  it("parses --details, defaults false", () => {
    expect(parseOptions(["--details"]).details).toBe(true);
    expect(parseOptions([]).details).toBe(false);
  });

  it("never changes command selection (a render flag, not a positional)", async () => {
    const { resolveCommand } = await import("../../src/cli/args.js");
    expect(await resolveCommand(["--details"])).toBe("receipt");
    expect(await resolveCommand(["--details", "--json"])).toBe("receipt");
  });

  it("R6: --details with a non-classic template exits 1 with the exact guard message, before any session load", async () => {
    for (const template of ["grocery", "datavis"]) {
      const { code, out, err } = await runMain(["--details", "--template", template]);
      expect(code).toBe(1);
      expect(err).toContain("--details supports the classic template only");
      expect(out).toBe("");
    }
  });

  // The classic-pass and section-render paths run in test/cli-e2e/built-cli.test.ts
  // under a sandboxed home — in-process main() here would scan the real machine's
  // session roots (slow and environment-dependent).

  it("R8: receiptTelemetryFromModels threads detailsView through to a schema-valid event payload", () => {
    for (const detailsView of [true, false]) {
      const input = receiptTelemetryFromModels({
        surface: "receipt",
        models: [],
        outputMode: "text",
        template: "none",
        turnCount: 3,
        toolCallCount: 4,
        detailsView,
      });
      expect(input.detailsView).toBe(detailsView);
      const valid = validateEvent({
        name: "receipt_generated",
        properties: {
          surface: "receipt",
          agentType: "unknown",
          multiAgent: false,
          outputMode: "text",
          template: "none",
          pricedRowCoverage: "none",
          hasStuckLoopWaste: false,
          hasTrivialSpansWaste: false,
          hasContextThrashWaste: false,
          hasPriceDelta: false,
          hasSubagents: false,
          detailsView,
          turnCountBucket: "2-3",
          toolCallCountBucket: "4-10",
          receiptOrdinalBucket: "1",
        },
      });
      expect(valid).toBe(true);
    }
  });

  it("lists --details in the assembled --help output", async () => {
    const { code, out } = await runMain(["--help"]);
    expect(code).toBe(0);
    expect(out).toContain("--details");
    expect(out).toContain("classic template only");
  });
});
