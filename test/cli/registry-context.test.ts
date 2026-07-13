// SPEC-0018 R3 regression: the stdin-reading commands (statusline, quota) must
// route their output through `ctx.stdout`, not `process.stdout`. This guards the
// Codex review finding — a command writing to a process global instead of the
// context seam is invisible to per-command stdout injection. We run each command's
// `run(ctx)` with a fake context and assert the output lands in `ctx.stdout` and
// that `process.stdout` is never touched.
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseOptions } from "../../src/cli/options.js";
import type { CommandContext } from "../../src/cli/types.js";
import { command as statuslineCommand } from "../../src/cli/commands/statusline.js";
import { command as quotaCommand } from "../../src/cli/commands/quota.js";

const FIXTURE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/claude-code/clean-multi-tool-2-models.jsonl",
);

function stdinStub(payload: string): NodeJS.ReadStream {
  const stream = Readable.from(payload ? [Buffer.from(payload, "utf8")] : []) as unknown as NodeJS.ReadStream;
  (stream as unknown as { isTTY: boolean }).isTTY = false;
  return stream;
}

function fakeContext(argv: string[], stdin: NodeJS.ReadStream): { ctx: CommandContext; out: () => string } {
  let out = "";
  const stdout = { write: (s: string) => ((out += s), true) } as unknown as NodeJS.WriteStream;
  const stderr = { write: () => true } as unknown as NodeJS.WriteStream;
  const ctx: CommandContext = {
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
      recordReviewPatternEvaluated: () => {},
      noteMilestone: async () => {},
    },
    renderHelp: () => "",
  };
  return { ctx, out: () => out };
}

describe("SPEC-0018 R3 · stdin commands write through ctx.stdout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("quota renders its lines to ctx.stdout, not process.stdout", async () => {
    const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const payload = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 42 } } });
    const { ctx, out } = fakeContext(["--quota"], stdinStub(payload));
    const code = await quotaCommand.run(ctx);
    expect(code).toBe(0);
    expect(out()).toBe("your 5h window is at 42% (official, from Claude Code's local data)\n");
    expect(spy).not.toHaveBeenCalled();
  });

  it("statusline renders its one-liner to ctx.stdout, not process.stdout", async () => {
    const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const payload = JSON.stringify({ transcript_path: FIXTURE });
    const { ctx, out } = fakeContext(["statusline"], stdinStub(payload));
    const code = await statuslineCommand.run(ctx);
    expect(code).toBe(0);
    expect(out().length).toBeGreaterThan(0);
    expect(out().endsWith("\n")).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});
