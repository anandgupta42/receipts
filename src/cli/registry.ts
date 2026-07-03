// SPEC-0018 R1: deterministic, package-local command discovery that survives the
// tsup bundle. Command modules are emitted as their own files under
// `dist/cli/commands/` (glob entry in tsup.config.ts), so at runtime we read that
// directory, sort by filename, and dynamically import each — no committed or
// generated registry import list, and adding a command never edits a shared file.
// R2: selection is priority-ordered per-command metadata, byte-compatible with
// the old `parseArgs` precedence.
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import type { CommandDef } from "./types.js";
import type { CliOptions } from "./options.js";
import { parseOptions } from "./options.js";

/**
 * Resolve the command-modules directory relative to this module's own URL. In
 * dev this module is `src/cli/registry.ts`, so `./commands/` is `src/cli/commands`.
 * Bundled, this code lands in a file at the `dist/` root, so `./cli/commands/` is
 * `dist/cli/commands`. The two candidates are mutually exclusive; the first that
 * exists wins.
 */
function commandsDir(): string {
  const candidates = [new URL("./commands/", import.meta.url), new URL("./cli/commands/", import.meta.url)];
  for (const url of candidates) {
    const path = fileURLToPath(url);
    if (existsSync(path)) return path;
  }
  throw new Error("aireceipts: command modules directory not found");
}

/** A command source file (dev `.ts`, prod `.js`), excluding sourcemaps, decls, and tests. */
function isCommandFile(name: string): boolean {
  if (!/\.(ts|js)$/.test(name)) return false;
  if (/\.d\.ts$/.test(name)) return false;
  if (/\.test\.(ts|js)$/.test(name)) return false;
  return true;
}

let cache: Promise<CommandDef[]> | undefined;

/** Discover the command set once per process, in sorted-filename (deterministic) order. */
export function loadCommands(): Promise<CommandDef[]> {
  if (!cache) {
    cache = discover();
  }
  return cache;
}

async function discover(): Promise<CommandDef[]> {
  const dir = commandsDir();
  const files = readdirSync(dir).filter(isCommandFile).sort();
  const commands: CommandDef[] = [];
  for (const file of files) {
    const mod = (await import(pathToFileURL(join(dir, file)).href)) as { command?: CommandDef };
    if (mod.command && typeof mod.command.run === "function") {
      commands.push(mod.command);
    }
  }
  return commands;
}

/**
 * SPEC-0018 R2: pick the command for a parsed invocation. Highest `priority`
 * whose `matches` fires wins (ties broken by name for determinism); the receipt
 * command (priority 0, matches always) is the default, so this never fails to
 * resolve in a well-formed command set.
 */
export function selectCommand(commands: readonly CommandDef[], options: CliOptions): CommandDef {
  const ordered = [...commands].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  for (const command of ordered) {
    if (command.matches(options)) {
      return command;
    }
  }
  throw new Error("aireceipts: no command matched (missing default receipt command?)");
}

/**
 * SPEC-0018 stable selection seam (re-exported from `./args.js`): the command an
 * argv selects. Reimplemented here over the registry; the R8 preservation suite
 * pins that this stays byte-identical to the pre-refactor `parseArgs` precedence.
 */
export async function resolveCommand(argv: string[]): Promise<string> {
  return selectCommand(await loadCommands(), parseOptions(argv)).name;
}
