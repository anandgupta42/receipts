// SessionEnd hook install/uninstall I/O (SPEC-0006 R1/R3/R5/R6). Reads/writes
// the real Claude Code settings.json under ~/.claude (or $CLAUDE_CONFIG_DIR —
// the documented override the platform spike used for isolation). Writes are
// atomic (tmp file + rename) with a one-shot settings.json.bak; installs are
// consent-gated (R1). All settings-tree edits are delegated to the pure
// helpers in ./settings.ts.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  HOOK_COMMAND,
  diffLines,
  hasHookEntry,
  malformedHooksShape,
  parseSettings,
  serializeSettings,
  withHookEntry,
  withoutHookEntry,
} from "./settings.js";

/** Injected side-effects so the command is testable without a real TTY. */
export interface HookIo {
  /** Print the diff, ask `[y/N]`; resolve true only on an explicit yes (R1). */
  confirm: (promptText: string) => Promise<boolean>;
  out: (s: string) => void;
  err: (s: string) => void;
}

/** Resolve the settings.json path, honoring `$CLAUDE_CONFIG_DIR` (defaults to ~/.claude). */
export function resolveSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.length > 0 ? env.CLAUDE_CONFIG_DIR : join(homedir(), ".claude");
  return join(dir, "settings.json");
}

/** Copy the current file to `<path>.bak` once — never clobbering a backup we didn't create (R3 one-shot). */
function backupOnce(path: string): void {
  const bak = `${path}.bak`;
  if (existsSync(path) && !existsSync(bak)) {
    copyFileSync(path, bak);
  }
}

/** Write `contents` to `path` atomically: a sibling tmp file + rename (R3). */
function atomicWrite(path: string, contents: string): void {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, contents);
  renameSync(tmp, path);
}

/** Read current settings text, or "" when the file is absent (a fresh box). */
function readSettingsText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export async function installHook(io: HookIo, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const path = resolveSettingsPath(env);
  const currentText = readSettingsText(path);

  let settings: Record<string, unknown>;
  try {
    settings = parseSettings(currentText);
  } catch {
    io.err(`settings.json at ${path} is not valid JSON — aborting with no changes.`);
    return 1;
  }

  const malformed = malformedHooksShape(settings);
  if (malformed) {
    io.err(`settings.json at ${path} has an unexpected shape (${malformed}) — aborting with no changes.`);
    return 1;
  }

  if (hasHookEntry(settings)) {
    io.out("aireceipts SessionEnd hook already installed — nothing to do.");
    return 0;
  }

  const { next } = withHookEntry(settings);
  const nextText = serializeSettings(next);
  io.out(`aireceipts will add a SessionEnd hook to ${path}:\n`);
  io.out(diffLines(currentText, nextText));
  io.out("\n(Existing settings are preserved; formatting may be normalized to 2-space JSON.)\n");

  const yes = await io.confirm("Apply this change? [y/N] ");
  if (!yes) {
    io.out("No changes made.");
    return 0;
  }

  mkdirSync(dirname(path), { recursive: true });
  backupOnce(path);
  atomicWrite(path, nextText);
  io.out(`Installed. A 6-line receipt now prints when a Claude Code session ends (\`${HOOK_COMMAND}\`).`);
  return 0;
}

export async function uninstallHook(io: HookIo, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const path = resolveSettingsPath(env);
  if (!existsSync(path)) {
    io.out("no settings.json found — nothing to uninstall.");
    return 0;
  }

  let settings: Record<string, unknown>;
  try {
    settings = parseSettings(readFileSync(path, "utf8"));
  } catch {
    io.err(`settings.json at ${path} is not valid JSON — aborting with no changes.`);
    return 1;
  }

  if (!hasHookEntry(settings)) {
    io.out("aireceipts SessionEnd hook not present — nothing to do.");
    return 0;
  }

  const { next } = withoutHookEntry(settings);
  backupOnce(path);
  atomicWrite(path, serializeSettings(next));
  io.out("Removed the aireceipts SessionEnd hook.");
  return 0;
}
