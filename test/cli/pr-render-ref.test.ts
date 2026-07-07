// SPEC-0066 R1/R3 — `pr-render-ref` is the CI render entrypoint: read an untrusted
// PrReceiptPayload on stdin, validate + sanitize, print the comment body. A malformed
// payload exits non-zero with nothing on stdout (CI treats it as "no receipt").
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { parseOptions } from "../../src/cli/options.js";
import type { CommandContext } from "../../src/cli/types.js";
import { command } from "../../src/cli/commands/pr-render-ref.js";
import { PR_RECEIPT_SCHEMA_VERSION } from "../../src/pr/payloadTypes.js";

function stdinStub(payload: string): NodeJS.ReadStream {
  const stream = Readable.from(payload ? [Buffer.from(payload, "utf8")] : []) as unknown as NodeJS.ReadStream;
  (stream as unknown as { isTTY: boolean }).isTTY = false;
  return stream;
}

function fakeContext(argv: string[], stdin: NodeJS.ReadStream): { ctx: CommandContext; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  const stdout = { write: (s: string) => ((out += s), true) } as unknown as NodeJS.WriteStream;
  const stderr = { write: (s: string) => ((err += s), true) } as unknown as NodeJS.WriteStream;
  const ctx = {
    options: parseOptions(argv),
    stdin,
    stdout,
    stderr,
    env: {},
    cwd: () => process.cwd(),
    now: () => 0,
    fs: { writeFile: async () => {} },
    prompt: async () => false,
    telemetry: {
      showPayload: () => ({ enabled: false, events: [] }),
      noteReceiptGenerated: async () => {},
      recordExportGenerated: () => {},
      recordPrFlowCompleted: () => {},
      recordHookConfigured: () => {},
      recordIntegrationSurfaceRendered: () => {},
      noteMilestone: async () => {},
    },
    renderHelp: () => "",
  } as unknown as CommandContext;
  return { ctx, out: () => out, err: () => err };
}

describe("SPEC-0066 pr-render-ref", () => {
  it("matches the `pr-render-ref` positional only", () => {
    expect(command.matches(parseOptions(["pr-render-ref"]))).toBe(true);
    expect(command.matches(parseOptions(["pr"]))).toBe(false);
  });

  it("renders the comment body from a valid payload and exits 0", async () => {
    const payload = JSON.stringify({
      schemaVersion: PR_RECEIPT_SCHEMA_VERSION,
      bodyInput: { contributors: [], excludedCount: 0 },
      extras: { artifactLink: { fileName: "pr.html", url: "https://anandgupta42.github.io/receipts/view.html" } },
    });
    const { ctx, out } = fakeContext(["pr-render-ref"], stdinStub(payload));
    expect(await command.run(ctx)).toBe(0);
    expect(out()).toContain("full receipt:");
    expect(out()).toContain("https://anandgupta42.github.io/receipts/view.html");
  });

  it("rejects an invalid payload: exit 1, nothing on stdout, reason on stderr", async () => {
    const { ctx, out, err } = fakeContext(["pr-render-ref"], stdinStub("{not json"));
    expect(await command.run(ctx)).toBe(1);
    expect(out()).toBe("");
    expect(err()).toContain("invalid receipt payload");
  });

  it("sanitizes a hostile payload before rendering — no live javascript link survives", async () => {
    const hostile = JSON.stringify({
      schemaVersion: PR_RECEIPT_SCHEMA_VERSION,
      bodyInput: { contributors: [], excludedCount: 0 },
      extras: { artifactLink: { fileName: "p.html", url: "javascript:alert(1)" } },
    });
    const { ctx, out } = fakeContext(["pr-render-ref"], stdinStub(hostile));
    expect(await command.run(ctx)).toBe(0);
    expect(out()).not.toMatch(/\]\(\s*javascript:/i);
    // the javascript: artifact url is dropped, so no "full receipt:" link line renders
    expect(out()).not.toContain("full receipt:");
  });
});
