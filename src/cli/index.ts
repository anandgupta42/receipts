// SPEC-0018: the CLI lifecycle only. Flag parsing (options.ts), deterministic
// command discovery + selection (registry.ts), the per-invocation context
// (context.ts), and every command's behavior (commands/*.ts) live in their own
// modules — adding a command edits its own file, never this one. main() owns
// exactly the telemetry lifecycle (R6): parse → select → first-run notice → run →
// record → bounded flush. The re-exports keep the statusline and handoff test
// entry points importable from `src/cli/index.js` across the refactor.
import { ensureFirstRunNotice, flushTelemetry, noteRunStart, recordCliError, recordCliRun } from "../telemetry/index.js";
import { parseOptions } from "./options.js";
import { loadCommands, selectCommand } from "./registry.js";
import { createContext } from "./context.js";

export { readStdin, loadFromStdinPayload, loadFromDisk, loadFromCwd, MAX_SCOPED_LOAD_ATTEMPTS, runStatusline } from "./commands/statusline.js";
export { recentWasteAggregates } from "./commands/handoff.js";

/** CLI entrypoint: parse → discover/select → first-run notice → run → telemetry record → bounded flush (SPEC-0002 wiring). */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const options = parseOptions(argv);
  const commands = await loadCommands();
  const command = selectCommand(commands, options);
  // `telemetry-show` is the inspect-what-would-be-sent command: it must itself
  // send nothing and record nothing, or the privacy-preview surface becomes a
  // privacy leak (v0.1.0 docs-board BLOCKER). It's exempt from the first-run
  // notice, the run-counter start, the `cli_run` record, AND the flush below.
  // SPEC-0073's PreToolUse hook gets the same treatment so it stays zero-output
  // and local-only when invoked inside an agent tool gate.
  const isTelemetryShow = command.name === "telemetry-show";
  const isSilentHook = command.name === "hook-pre-push";
  const skipTelemetry = isTelemetryShow || isSilentHook;
  if (!skipTelemetry) {
    await ensureFirstRunNotice((text) => process.stderr.write(text + "\n"), undefined);
  }
  const ctx = createContext(options, commands);
  const runTelemetry = skipTelemetry ? undefined : await noteRunStart(command.name, process.env);
  const started = Date.now();
  try {
    const code = await command.run(ctx);
    if (runTelemetry) {
      recordCliRun({
        command: command.name,
        agentType: undefined,
        durationMs: Date.now() - started,
        ok: code === 0,
        // SPEC-0042 R5 — emission mode for the handoff command only (enum, never content).
        ...(command.name === "handoff" ? { handoffFormat: options.json ? ("json" as const) : ("text" as const) } : {}),
        ...runTelemetry,
      });
    }
    return code;
  } catch (err) {
    if (!skipTelemetry) {
      recordCliError({ command: command.name, agentType: undefined, err });
    }
    if (!isSilentHook) {
      process.stderr.write(String(err instanceof Error ? err.message : err) + "\n");
    }
    return isSilentHook ? 0 : 1;
  } finally {
    if (!skipTelemetry) {
      await flushTelemetry();
    }
  }
}
