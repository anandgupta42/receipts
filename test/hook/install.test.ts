// SPEC-0006 R1/R3/R5/R6 install/uninstall I/O, driven against a real temp
// CLAUDE_CONFIG_DIR (never the user's ~/.claude). Covers: consent gating,
// structural merge with unrelated hooks, unparseable abort with no write,
// atomic write + one-shot .bak, idempotency, and the uninstall round-trip.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installHook, resolveSettingsPath, uninstallHook } from "../../src/hook/install.js";
import type { HookIo } from "../../src/hook/install.js";
import { HOOK_COMMAND } from "../../src/hook/settings.js";

/** A capturing HookIo: arrays for assertions, a fixed confirm answer. */
function capIo(answer: boolean): { hookIo: HookIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const hookIo: HookIo = {
    confirm: async () => answer,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  };
  return { hookIo, out, err };
}

/** A fresh temp CLAUDE_CONFIG_DIR — never the user's real ~/.claude. */
function envDir(): { CLAUDE_CONFIG_DIR: string } {
  return { CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), "aireceipts-hook-")) };
}

describe("installHook (R1 consent)", () => {
  it("writes the entry when the user confirms", async () => {
    const env = envDir();
    const { hookIo } = capIo(true);
    const code = await installHook(hookIo, env as NodeJS.ProcessEnv);
    expect(code).toBe(0);
    const text = readFileSync(resolveSettingsPath(env as NodeJS.ProcessEnv), "utf8");
    expect(text).toContain(HOOK_COMMAND);
    expect(JSON.parse(text).hooks.SessionEnd).toHaveLength(1);
  });

  it("leaves the file untouched and exits 0 when the user declines", async () => {
    const env = envDir();
    const path = resolveSettingsPath(env as NodeJS.ProcessEnv);
    mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
    writeFileSync(path, '{"model":"x"}\n');
    const { hookIo, out } = capIo(false);
    const code = await installHook(hookIo, env as NodeJS.ProcessEnv);
    expect(code).toBe(0);
    expect(readFileSync(path, "utf8")).toBe('{"model":"x"}\n');
    expect(out.join("\n")).toContain("No changes made.");
  });

  it("prints the diff (containing the command) before prompting (R1)", async () => {
    const env = envDir();
    const { hookIo, out } = capIo(false);
    await installHook(hookIo, env as NodeJS.ProcessEnv);
    expect(out.join("\n")).toContain(HOOK_COMMAND);
  });
});

describe("installHook (R3 merge / atomicity / idempotency)", () => {
  it("adds only the new entry; unrelated hooks stay deep-equal", async () => {
    const env = envDir();
    const path = resolveSettingsPath(env as NodeJS.ProcessEnv);
    mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
    const original = {
      permissions: { defaultMode: "auto" },
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard" }] }],
      },
    };
    writeFileSync(path, JSON.stringify(original, null, 2) + "\n");
    const { hookIo } = capIo(true);
    await installHook(hookIo, env as NodeJS.ProcessEnv);
    const after = JSON.parse(readFileSync(path, "utf8"));
    expect(after.permissions).toEqual(original.permissions);
    expect(after.hooks.PreToolUse).toEqual(original.hooks.PreToolUse);
    expect(after.hooks.SessionEnd).toHaveLength(1);
  });

  it("aborts with a message and NO write on unparseable JSON (R3)", async () => {
    const env = envDir();
    const path = resolveSettingsPath(env as NodeJS.ProcessEnv);
    mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
    writeFileSync(path, "{ this is not json ");
    const { hookIo, err } = capIo(true);
    const code = await installHook(hookIo, env as NodeJS.ProcessEnv);
    expect(code).toBe(1);
    expect(readFileSync(path, "utf8")).toBe("{ this is not json ");
    expect(err.join("\n")).toContain("not valid JSON");
  });

  it("aborts with NO write when hooks is a present-but-malformed shape (R3)", async () => {
    const env = envDir();
    const path = resolveSettingsPath(env as NodeJS.ProcessEnv);
    mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
    const malformed = '{"hooks":"not-an-object"}';
    writeFileSync(path, malformed);
    const { hookIo, err } = capIo(true);
    const code = await installHook(hookIo, env as NodeJS.ProcessEnv);
    expect(code).toBe(1);
    expect(readFileSync(path, "utf8")).toBe(malformed);
    expect(err.join("\n")).toContain("unexpected shape");
  });

  it("creates a one-shot settings.json.bak on write, and does not clobber it", async () => {
    const env = envDir();
    const path = resolveSettingsPath(env as NodeJS.ProcessEnv);
    mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
    writeFileSync(path, '{"model":"orig"}\n');
    await installHook(capIo(true).hookIo, env as NodeJS.ProcessEnv);
    const bak = `${path}.bak`;
    expect(existsSync(bak)).toBe(true);
    expect(readFileSync(bak, "utf8")).toBe('{"model":"orig"}\n');
    // a subsequent uninstall must not overwrite the original backup
    await uninstallHook(capIo(true).hookIo, env as NodeJS.ProcessEnv);
    expect(readFileSync(bak, "utf8")).toBe('{"model":"orig"}\n');
  });

  it("re-running when installed is an idempotent no-op", async () => {
    const env = envDir();
    const path = resolveSettingsPath(env as NodeJS.ProcessEnv);
    await installHook(capIo(true).hookIo, env as NodeJS.ProcessEnv);
    const firstText = readFileSync(path, "utf8");
    const { hookIo, out } = capIo(true);
    const code = await installHook(hookIo, env as NodeJS.ProcessEnv);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("already installed");
    expect(readFileSync(path, "utf8")).toBe(firstText);
    expect(JSON.parse(firstText).hooks.SessionEnd).toHaveLength(1);
  });

  it("works on a clean box with no settings.json yet (<30s kill criterion)", async () => {
    const env = envDir();
    const path = resolveSettingsPath(env as NodeJS.ProcessEnv);
    expect(existsSync(path)).toBe(false);
    const code = await installHook(capIo(true).hookIo, env as NodeJS.ProcessEnv);
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(path, "utf8")).hooks.SessionEnd).toHaveLength(1);
  });
});

describe("uninstallHook (R5)", () => {
  it("removes exactly the entry install added (round-trip)", async () => {
    const env = envDir();
    const path = resolveSettingsPath(env as NodeJS.ProcessEnv);
    mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
    const original = { model: "x", hooks: { PreToolUse: [{ matcher: "Bash", hooks: [] }] } };
    writeFileSync(path, JSON.stringify(original, null, 2) + "\n");
    await installHook(capIo(true).hookIo, env as NodeJS.ProcessEnv);
    const code = await uninstallHook(capIo(true).hookIo, env as NodeJS.ProcessEnv);
    expect(code).toBe(0);
    const after = JSON.parse(readFileSync(path, "utf8"));
    expect(after.model).toBe("x");
    expect(after.hooks.PreToolUse).toEqual(original.hooks.PreToolUse);
    expect(after.hooks.SessionEnd).toBeUndefined();
  });

  it("is a no-op (exit 0) when the entry is absent", async () => {
    const env = envDir();
    const path = resolveSettingsPath(env as NodeJS.ProcessEnv);
    mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
    writeFileSync(path, '{"model":"x"}\n');
    const { hookIo, out } = capIo(true);
    const code = await uninstallHook(hookIo, env as NodeJS.ProcessEnv);
    expect(code).toBe(0);
    expect(readFileSync(path, "utf8")).toBe('{"model":"x"}\n');
    expect(out.join("\n")).toContain("nothing to do");
  });

  it("is a no-op (exit 0) when there is no settings.json at all", async () => {
    const env = envDir();
    const { hookIo, out } = capIo(true);
    const code = await uninstallHook(hookIo, env as NodeJS.ProcessEnv);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("nothing to uninstall");
  });
});
