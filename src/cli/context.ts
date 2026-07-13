// SPEC-0018 R3: build the production `CommandContext` — the process-backed
// side-effecting seams every command runs through. Tests construct their own
// context (or call a command's pure inner helpers) with fakes, so no command
// reaches through process globals directly.
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { CommandContext, CommandDef } from "./types.js";
import type { CliOptions } from "./options.js";
import { assembleHelp } from "./help.js";
import {
  noteMilestone,
  noteReceiptGenerated,
  recordExportGenerated,
  recordHookConfigured,
  recordIntegrationSurfaceRendered,
  recordPrFlowCompleted,
  recordReviewPatternEvaluated,
  showTelemetryPayload,
} from "../telemetry/index.js";

/**
 * Read a single `[y/N]` answer; true only on an explicit yes. On EOF / no TTY the
 * `question` callback never fires, so the `close` handler resolves the default No
 * rather than hanging (moved verbatim from the pre-refactor CLI hook confirm).
 */
function stdinConfirm(question: string, stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout });
    let answered = false;
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
    rl.on("close", () => {
      if (!answered) {
        resolve(false);
      }
    });
  });
}

/** Assemble the real context for one invocation. `commands` feeds the help renderer. */
export function createContext(options: CliOptions, commands: readonly CommandDef[]): CommandContext {
  const { stdin, stdout, stderr } = process;
  return {
    options,
    stdin,
    stdout,
    stderr,
    env: process.env,
    cwd: () => process.cwd(),
    now: () => Date.now(),
    fs: { writeFile: (path, data) => writeFile(path, data) },
    prompt: (question) => stdinConfirm(question, stdin, stdout),
    telemetry: {
      showPayload: (env) => showTelemetryPayload(env),
      noteReceiptGenerated,
      recordExportGenerated,
      recordPrFlowCompleted,
      recordHookConfigured,
      recordIntegrationSurfaceRendered,
      recordReviewPatternEvaluated,
      noteMilestone,
    },
    renderHelp: () => assembleHelp(commands),
  };
}
