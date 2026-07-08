// SPEC-0073 — hidden Claude Code PreToolUse hook. It reads the hook payload,
// recognizes a real `git push` branch push with the tokenized git parser, and
// best-effort attaches `refs/receipts/<slug>` without ever writing a hook
// decision object or blocking the developer's push.
import { runPrDetailed, defaultPrDeps } from "../../pr/index.js";
import { classifyPush, toolCallInvocations } from "../../pr/gitWrite.js";
import type { ToolCall } from "../../parse/types.js";
import { readStdin } from "./statusline.js";
import type { CommandContext, CommandDef } from "../types.js";

export interface HookPrePushDeps {
  attachRef: (cwd: string) => Promise<void>;
}

const SILENT = () => {};

export const defaultHookPrePushDeps: HookPrePushDeps = {
  attachRef: async (cwd) => {
    await runPrDetailed(
      {
        post: false,
        store: "ref",
        pushRef: true,
      },
      defaultPrDeps({
        cwd,
        out: SILENT,
        err: SILENT,
      }),
    );
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseObject(value: unknown): Record<string, unknown> | undefined {
  if (isObject(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isShellTool(name: unknown): boolean {
  if (typeof name !== "string") {
    return false;
  }
  const normalized = name.toLowerCase();
  return (
    normalized === "bash" ||
    normalized === "shell" ||
    normalized === "sh" ||
    normalized === "zsh" ||
    normalized === "exec_command" ||
    normalized.endsWith(".exec_command")
  );
}

function payloadToolName(payload: Record<string, unknown>): unknown {
  return payload.tool_name ?? payload.toolName ?? payload.name ?? payload.tool;
}

function payloadInput(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  return (
    parseObject(payload.tool_input) ??
    parseObject(payload.toolInput) ??
    parseObject(payload.input) ??
    parseObject(payload.arguments) ??
    parseObject(payload.params)
  );
}

function commandSource(payload: Record<string, unknown>, input: Record<string, unknown>): unknown {
  return input.command ?? input.cmd ?? payload.command ?? payload.cmd;
}

function shouldAttach(payload: unknown): boolean {
  if (!isObject(payload) || !isShellTool(payloadToolName(payload))) {
    return false;
  }
  const input = payloadInput(payload) ?? payload;
  const source = commandSource(payload, input);
  if (typeof source !== "string" && (!Array.isArray(source) || !source.every((v) => typeof v === "string"))) {
    return false;
  }
  const call: ToolCall = { name: String(payloadToolName(payload)), shell: true, input: { command: source } };
  const invocations = toolCallInvocations(call);
  if (invocations.length !== 1) {
    return false;
  }
  return classifyPush(invocations[0]).attach;
}

export async function runHookPrePush(ctx: CommandContext, deps: HookPrePushDeps = defaultHookPrePushDeps): Promise<number> {
  try {
    const raw = await readStdin(ctx.stdin);
    if (!raw.trim()) {
      return 0;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return 0;
    }
    if (shouldAttach(payload)) {
      await deps.attachRef(ctx.cwd());
    }
  } catch {
    // Best-effort hook: every failure path is silent and exits 0.
  }
  return 0;
}

async function run(ctx: CommandContext): Promise<number> {
  return runHookPrePush(ctx);
}

export const command: CommandDef = {
  name: "hook-pre-push",
  priority: 60,
  matches: (options) => options.positional[0] === "hook" && options.positional[1] === "pre-push",
  run,
};
