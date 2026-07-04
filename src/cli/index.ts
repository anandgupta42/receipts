// SPEC-0018: the CLI lifecycle only. Flag parsing (options.ts), deterministic
// command discovery + selection (registry.ts), the per-invocation context
// (context.ts), and every command's behavior (commands/*.ts) live in their own
// modules — adding a command edits its own file, never this one. main() owns
// exactly the telemetry lifecycle (R6): parse → select → first-run notice → run →
// record → bounded flush. The re-exports keep the statusline and handoff test
// entry points importable from `src/cli/index.js` across the refactor.
import { ensureFirstRunNotice, flushTelemetry, recordCliError, recordCliRun } from "../telemetry/index.js";
import { parseOptions } from "./options.js";
import { loadCommands, selectCommand } from "./registry.js";
import { createContext } from "./context.js";

export { readStdin, loadFromStdinPayload, loadFromDisk, runStatusline } from "./commands/statusline.js";
export { recentWasteAggregates } from "./commands/handoff.js";

/** CLI entrypoint: parse → discover/select → first-run notice → run → telemetry record → bounded flush (SPEC-0002 wiring). */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const options = parseOptions(argv);
  const commands = await loadCommands();
  const command = selectCommand(commands, options);
  if (command.name !== "telemetry-show") {
    await ensureFirstRunNotice((text) => process.stderr.write(text + "\n"), undefined);
  }
  const ctx = createContext(options, commands);
  const started = Date.now();
  try {
    const code = await command.run(ctx);
    recordCliRun({
      command: command.name,
      agentType: undefined,
      durationMs: Date.now() - started,
      ok: code === 0,
      // SPEC-0042 R5 — emission mode for the handoff command only (enum, never content).
      ...(command.name === "handoff" ? { handoffFormat: options.json ? ("json" as const) : ("text" as const) } : {}),
    });
    return code;
  } catch (err) {
    recordCliError({ command: command.name, agentType: undefined, err });
    process.stderr.write(String(err instanceof Error ? err.message : err) + "\n");
    return 1;
  } finally {
    await flushTelemetry();
  }
}
