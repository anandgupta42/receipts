import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { parseOptions } from "../../src/cli/options.js";
import type { CommandContext } from "../../src/cli/types.js";
import { command, runHookPrePush } from "../../src/cli/commands/hook-pre-push.js";
import { main } from "../../src/cli/index.js";

function stdinStub(payload: string): NodeJS.ReadStream {
  const stream = Readable.from(payload ? [Buffer.from(payload, "utf8")] : []) as unknown as NodeJS.ReadStream;
  (stream as unknown as { isTTY: boolean }).isTTY = false;
  return stream;
}

function fakeContext(payload: string): { ctx: CommandContext; out: () => string; err: () => string } {
  let out = "";
  let err = "";
  const stdout = { write: (s: string) => ((out += s), true) } as unknown as NodeJS.WriteStream;
  const stderr = { write: (s: string) => ((err += s), true) } as unknown as NodeJS.WriteStream;
  const ctx = {
    options: parseOptions(["hook", "pre-push"]),
    stdin: stdinStub(payload),
    stdout,
    stderr,
    env: {},
    cwd: () => "/repo",
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
  } as unknown as CommandContext;
  return { ctx, out: () => out, err: () => err };
}

async function runPayload(payload: unknown, attachThrows = false): Promise<{ code: number; out: string; err: string; attaches: string[] }> {
  const { ctx, out, err } = fakeContext(typeof payload === "string" ? payload : JSON.stringify(payload));
  const attaches: string[] = [];
  const code = await runHookPrePush(ctx, {
    attachRef: async (cwd) => {
      attaches.push(cwd);
      if (attachThrows) {
        throw new Error("boom");
      }
    },
  });
  return { code, out: out(), err: err(), attaches };
}

const claudePayload = (command: string) => ({ tool_name: "Bash", tool_input: { command } });

describe("SPEC-0073 hook pre-push command", () => {
  it("matches only the hidden hook pre-push positional", () => {
    expect(command.matches(parseOptions(["hook", "pre-push"]))).toBe(true);
    expect(command.matches(parseOptions(["hook"]))).toBe(false);
    expect(command.help).toBeUndefined();
  });

  it.each([
    claudePayload("git push"),
    claudePayload("git push origin feat"),
    claudePayload("git push -u origin HEAD"),
    claudePayload("git push --force-with-lease origin HEAD"),
    claudePayload("git push origin HEAD:refs/heads/main"),
    { tool_name: "exec_command", tool_input: { cmd: "git push origin feat" } },
    { name: "functions.exec_command", arguments: JSON.stringify({ command: ["git", "push", "origin", "feat"] }) },
    { tool_name: "Bash", command: "git push origin feat" },
    claudePayload("git add -A && git commit -m msg && git push -u origin feat/x"),
    claudePayload("git push origin feat/x && gh pr create --fill"),
    claudePayload("git push -u origin feat/x 2>&1"),
    claudePayload("git commit -m x; git push 2>&1 | tail -3"),
    claudePayload("npm test && git push"),
    claudePayload("git push -u origin HEAD 2>&1 | tee /tmp/push.log"),
    claudePayload("git push && git push origin feat/x"),
  ])("attaches silently for branch push payload %#", async (payload) => {
    const result = await runPayload(payload);
    expect(result).toEqual({ code: 0, out: "", err: "", attaches: ["/repo"] });
  });

  it("accepts the documented Codex PreToolUse payload", async () => {
    const result = await runPayload({
      session_id: "session-1",
      transcript_path: "/tmp/session.jsonl",
      cwd: "/repo",
      hook_event_name: "PreToolUse",
      model: "gpt-5.6-codex",
      turn_id: "turn-1",
      permission_mode: "default",
      tool_name: "Bash",
      tool_use_id: "tool-1",
      tool_input: { command: "git push origin feat" },
    });
    expect(result).toEqual({ code: 0, out: "", err: "", attaches: ["/repo"] });
  });

  it.each([
    claudePayload("npm test"),
    claudePayload("git status"),
    claudePayload("git push --dry-run"),
    claudePayload("git push --delete origin feat"),
    claudePayload("git push --tags"),
    claudePayload("git push upstream feat"),
    claudePayload("git push origin refs/receipts/x"),
    claudePayload("git -C sub push origin feat"),
    claudePayload("git --git-dir=/other/.git --work-tree=/other push origin feat"),
    claudePayload('echo "git push"'),
    claudePayload('echo "git push origin main && more"'),
    claudePayload("cat <<'EOF'\ngit push\nEOF"),
    claudePayload("cd /elsewhere && git push"),
    claudePayload("MODE=quiet cd /elsewhere && git push"),
    claudePayload("git push; cd /elsewhere"),
    claudePayload("pushd /elsewhere && git push && popd"),
    claudePayload("git push --dry-run 2>&1"),
    { tool_name: "Read", tool_input: { command: "git push" } },
    {},
    "",
    "{not json",
  ])("does nothing and stays silent for non-matching payload %#", async (payload) => {
    const result = await runPayload(payload);
    expect(result).toEqual({ code: 0, out: "", err: "", attaches: [] });
  });

  it("swallows attach failures and still exits 0 with no output", async () => {
    const result = await runPayload(claudePayload("git push"), true);
    expect(result).toEqual({ code: 0, out: "", err: "", attaches: ["/repo"] });
  });
});

describe("SPEC-0073 hook pre-push lifecycle silence", () => {
  it("main skips first-run notice and telemetry output for the hook command", async () => {
    const saved = {
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      AIRECEIPTS_HOME: process.env.AIRECEIPTS_HOME,
      AIRECEIPTS_TELEMETRY: process.env.AIRECEIPTS_TELEMETRY,
    };
    const origIn = process.stdin;
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    let out = "";
    let err = "";
    Object.defineProperty(process, "stdin", { value: stdinStub("{not json"), configurable: true });
    process.stdout.write = ((c: string | Uint8Array) => {
      out += typeof c === "string" ? c : Buffer.from(c).toString("utf8");
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((c: string | Uint8Array) => {
      err += typeof c === "string" ? c : Buffer.from(c).toString("utf8");
      return true;
    }) as typeof process.stderr.write;
    process.env.HOME = "/tmp/aireceipts-hook-main-test";
    process.env.USERPROFILE = "/tmp/aireceipts-hook-main-test";
    delete process.env.AIRECEIPTS_HOME;
    delete process.env.AIRECEIPTS_TELEMETRY;
    try {
      expect(await main(["hook", "pre-push"])).toBe(0);
      expect(out).toBe("");
      expect(err).toBe("");
    } finally {
      Object.defineProperty(process, "stdin", { value: origIn, configurable: true });
      process.stdout.write = origOut;
      process.stderr.write = origErr;
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
