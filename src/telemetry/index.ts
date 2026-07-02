import type { AgentSource } from "../parse/types.js";
import { resolveTelemetryConfig } from "./config.js";
import { bucketDuration, classifyError, getCliVersion, isInPackage, toAgentTypeTelemetry, toCommandClass, toOsTelemetry } from "./helpers.js";
import { ensureFirstRunNotice, FIRST_RUN_NOTICE } from "./notice.js";
import { peekQueuedEvents, recordEvent, flushTelemetry } from "./sender.js";
import { hashSignature } from "./signature.js";

/**
 * Single public integration surface for SPEC-0002 diagnostics telemetry.
 * This is the one file `src/cli/**` (surface-owned) should import from —
 * every other module under `src/telemetry/` is an internal implementation
 * detail. See `docs/telemetry.md` for the full field-by-field schema and
 * `AGENTS.md`/SPEC-0002 for the invariants this module upholds (I4, R1-R6).
 */

export { flushTelemetry, ensureFirstRunNotice, FIRST_RUN_NOTICE };

export interface RecordCliRunInput {
  command: string;
  agentType: AgentSource | undefined;
  durationMs: number;
  ok: boolean;
}

/** Records one `cli_run` event (R2). Call once per CLI invocation, right before the process would otherwise exit. */
export function recordCliRun(input: RecordCliRunInput): void {
  recordEvent({
    name: "cli_run",
    properties: {
      cliVersion: getCliVersion(),
      os: toOsTelemetry(),
      nodeMajor: Number(process.versions.node.split(".")[0]),
      commandClass: toCommandClass(input.command),
      agentType: toAgentTypeTelemetry(input.agentType),
      durationBucket: bucketDuration(input.durationMs),
      ok: input.ok,
    },
  });
}

export interface RecordCliErrorInput {
  command: string;
  agentType: AgentSource | undefined;
  err: unknown;
}

/** Records one `cli_error` event (R2). Call from the CLI's top-level catch handler; never pass `err.message` or any derived text elsewhere — this function does the full raw-error-to-bounded-fields conversion internally. */
export function recordCliError(input: RecordCliErrorInput): void {
  recordEvent({
    name: "cli_error",
    properties: {
      errorClass: classifyError(input.err),
      command: toCommandClass(input.command),
      agentType: toAgentTypeTelemetry(input.agentType),
      inPackage: isInPackage(input.err),
    },
  });
}

export interface RecordParseFailureInput {
  agentType: AgentSource;
  adapterVersion: string;
  /** A content-free description of *where* parsing broke (e.g. `"claude-code:turn.usage.missing"`) — never a snippet of the transcript itself. Hashed before it ever reaches a payload. */
  shape: string;
}

/** Records one `parse_failure` event (R2). `shape` is hashed here — the raw string never leaves this function. */
export function recordParseFailure(input: RecordParseFailureInput): void {
  recordEvent({
    name: "parse_failure",
    properties: {
      agentType: input.agentType,
      adapterVersion: input.adapterVersion,
      signatureHash: hashSignature(input.shape),
    },
  });
}

/**
 * Backs `--telemetry-show` (R5): returns exactly what the current run's
 * queue would send on the next `flushTelemetry()` call, without sending
 * it. Also reports whether telemetry is currently enabled, so a user can
 * tell "nothing queued yet" apart from "telemetry is off."
 */
export function showTelemetryPayload(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; events: readonly unknown[] } {
  const config = resolveTelemetryConfig(env);
  return { enabled: config.enabled, events: peekQueuedEvents() };
}
