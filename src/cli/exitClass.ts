import type { ExitClassValue } from "../telemetry/schemas.js";
import type { CommandContext } from "./types.js";

// One context is created per main() invocation. A WeakMap keeps the mutable
// classification per run without widening CommandContext or leaking across
// concurrent invocations; unmarked non-zero returns default in main().
const exitClasses = new WeakMap<CommandContext, ExitClassValue>();

export function setExitClass(ctx: CommandContext, exitClass: ExitClassValue): void {
  exitClasses.set(ctx, exitClass);
}

export function exitClassOf(ctx: CommandContext): ExitClassValue | undefined {
  return exitClasses.get(ctx);
}
