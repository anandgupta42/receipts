import type { AgentSource } from "../parse/types.js";
import { resolveTelemetryConfig } from "./config.js";
import {
  bucketCount,
  bucketDuration,
  bucketInstallAge,
  bucketOrdinal,
  classifyError,
  getCliVersion,
  isCiEnv,
  isInPackage,
  toAgentTypeTelemetry,
  toCommandTelemetry,
  toOsTelemetry,
} from "./helpers.js";
import { ensureFirstRunNotice, FIRST_RUN_NOTICE } from "./notice.js";
import {
  type TelemetryState,
  ensureInstallId,
  installHashOf,
  readState,
  updateStateWithMeta,
} from "./state.js";
import { peekQueuedEvents, recordEvent, flushTelemetry } from "./sender.js";
import { hashSignature } from "./signature.js";
import type {
  ExportFormatValue,
  ExportSurfaceValue,
  HookOperationValue,
  InputModeValue,
  IntegrationValue,
  MilestoneValue,
  OutputModeValue,
  PrModeValue,
  PricedRowCoverageValue,
  PromptOutcomeValue,
  ReceiptSurfaceValue,
  ResultValue,
  StepResultValue,
  TemplateTelemetryValue,
} from "./schemas.js";

/**
 * Single public integration surface for SPEC-0002/SPEC-0043 telemetry.
 * This is the one file `src/cli/**` (surface-owned) should import from —
 * every other module under `src/telemetry/` is an internal implementation
 * detail. See `docs/telemetry.md` for the full field-by-field schema and
 * `AGENTS.md`/SPEC-0002/SPEC-0043 for the invariants this module upholds.
 */

export { flushTelemetry, ensureFirstRunNotice, FIRST_RUN_NOTICE, readState };
export type { TelemetryState };

export interface RunStartTelemetry {
  installHash: string;
  runOrdinalBucket: "1" | "2-3" | "4-10" | "11-50" | ">50" | "unavailable";
  isCI: boolean;
}

export interface RecordCliRunInput extends RunStartTelemetry {
  command: string;
  agentType: AgentSource | undefined;
  durationMs: number;
  ok: boolean;
  /** SPEC-0042 R5 — set only for the handoff command; enum, never content. */
  handoffFormat?: "text" | "json";
}

/** Records one `cli_run` event (R2). Unknown command names drop the event rather than leaking raw argv text. */
export function recordCliRun(input: RecordCliRunInput): void {
  const commandClass = toCommandTelemetry(input.command);
  if (!commandClass) {
    return;
  }
  recordEvent({
    name: "cli_run",
    properties: {
      cliVersion: getCliVersion(),
      os: toOsTelemetry(),
      nodeMajor: Number(process.versions.node.split(".")[0]),
      commandClass,
      agentType: toAgentTypeTelemetry(input.agentType),
      durationBucket: bucketDuration(input.durationMs),
      ok: input.ok,
      isCI: input.isCI,
      installHash: input.installHash,
      runOrdinalBucket: input.runOrdinalBucket,
      ...(input.handoffFormat !== undefined ? { handoffFormat: input.handoffFormat } : {}),
    },
  });
}

export interface RecordCliErrorInput {
  command: string;
  agentType: AgentSource | undefined;
  err: unknown;
}

/** Records one `cli_error` event (R2). Unknown command names drop the event rather than leaking raw argv text. */
export function recordCliError(input: RecordCliErrorInput): void {
  const command = toCommandTelemetry(input.command);
  if (!command) {
    return;
  }
  recordEvent({
    name: "cli_error",
    properties: {
      errorClass: classifyError(input.err),
      command,
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

export interface RecordReceiptGeneratedInput {
  surface: ReceiptSurfaceValue;
  agentType: AgentSource | undefined;
  multiAgent: boolean;
  outputMode: OutputModeValue;
  template: TemplateTelemetryValue;
  pricedRowCoverage: PricedRowCoverageValue;
  hasStuckLoopWaste: boolean;
  hasTrivialSpansWaste: boolean;
  hasContextThrashWaste: boolean;
  hasPriceDelta: boolean;
  /** SPEC-0061 R6 — subagent transcripts were folded into the rendered totals. */
  hasSubagents: boolean;
  /** SPEC-0054 R8 — the render carried the opt-in `--details` section. */
  detailsView: boolean;
  turnCount: number;
  toolCallCount: number;
  receiptOrdinal?: number;
}

export function recordReceiptGenerated(input: RecordReceiptGeneratedInput): void {
  recordEvent({
    name: "receipt_generated",
    properties: {
      surface: input.surface,
      agentType: toAgentTypeTelemetry(input.agentType),
      multiAgent: input.multiAgent,
      outputMode: input.outputMode,
      template: input.template,
      pricedRowCoverage: input.pricedRowCoverage,
      hasStuckLoopWaste: input.hasStuckLoopWaste,
      hasTrivialSpansWaste: input.hasTrivialSpansWaste,
      hasContextThrashWaste: input.hasContextThrashWaste,
      hasPriceDelta: input.hasPriceDelta,
      hasSubagents: input.hasSubagents,
      detailsView: input.detailsView,
      turnCountBucket: bucketCount(input.turnCount),
      toolCallCountBucket: bucketCount(input.toolCallCount),
      receiptOrdinalBucket: bucketOrdinal(input.receiptOrdinal),
    },
  });
}

export interface RecordExportGeneratedInput {
  surface: ExportSurfaceValue;
  format: ExportFormatValue;
  wroteFile: boolean;
  result: ResultValue;
}

export function recordExportGenerated(input: RecordExportGeneratedInput): void {
  recordEvent({ name: "export_generated", properties: input });
}

export interface RecordPrFlowCompletedInput {
  mode: PrModeValue;
  artifactRequested: boolean;
  shareRequested: boolean;
  contributorCount: number;
  commentResult: StepResultValue;
  artifactResult: StepResultValue;
  shareResult: StepResultValue;
  /** SPEC-0059 R8. */
  handoffSectionIncluded: boolean;
  result: ResultValue;
}

export function recordPrFlowCompleted(input: RecordPrFlowCompletedInput): void {
  recordEvent({
    name: "pr_flow_completed",
    properties: {
      mode: input.mode,
      artifactRequested: input.artifactRequested,
      shareRequested: input.shareRequested,
      contributorCountBucket: bucketCount(input.contributorCount),
      commentResult: input.commentResult,
      artifactResult: input.artifactResult,
      shareResult: input.shareResult,
      handoffSectionIncluded: input.handoffSectionIncluded,
      result: input.result,
    },
  });
}

export interface RecordHookConfiguredInput {
  operation: HookOperationValue;
  promptOutcome: PromptOutcomeValue;
  result: ResultValue;
}

export function recordHookConfigured(input: RecordHookConfiguredInput): void {
  recordEvent({ name: "hook_configured", properties: input });
}

export interface RecordIntegrationSurfaceRenderedInput {
  integration: IntegrationValue;
  inputMode: InputModeValue;
  payloadValid: boolean;
  result: ResultValue;
  /** SPEC-0062 R5 — statusline only: an explicit `--format` was passed (boolean, never the format string). */
  customFormat?: boolean;
}

export function recordIntegrationSurfaceRendered(input: RecordIntegrationSurfaceRenderedInput): void {
  recordEvent({ name: "integration_surface_rendered", properties: input });
}

export interface RecordActivationMilestoneInput {
  milestone: MilestoneValue;
  command: string;
  firstRunAt?: string;
  now?: number | Date;
}

export function recordActivationMilestone(input: RecordActivationMilestoneInput): void {
  const command = toCommandTelemetry(input.command);
  if (!command) {
    return;
  }
  recordEvent({
    name: "activation_milestone",
    properties: {
      milestone: input.milestone,
      command,
      installAgeBucket: bucketInstallAge(input.firstRunAt, input.now),
    },
  });
}

function isoDate(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Increments the local lifetime run counter and returns bounded fields for the eventual `cli_run` event. */
export async function noteRunStart(command: string, env: NodeJS.ProcessEnv = process.env, now: number = Date.now()): Promise<RunStartTelemetry> {
  const telemetryEnabled = resolveTelemetryConfig(env).enabled;
  let createdFirstRunMilestone = false;
  const result = await updateStateWithMeta((state) => {
    state.firstRunAt ??= isoDate(now);
    state.runCount += 1;
    ensureInstallId(state, telemetryEnabled);
    if (!state.milestones.first_run) {
      state.milestones.first_run = true;
      createdFirstRunMilestone = true;
    }
  });

  if (!result) {
    return { installHash: "unavailable", runOrdinalBucket: "unavailable", isCI: isCiEnv(env) };
  }

  if (createdFirstRunMilestone && !result.recovered) {
    recordActivationMilestone({ milestone: "first_run", command, firstRunAt: result.state.firstRunAt, now });
  }

  const installHash = telemetryEnabled && result.state.installId ? installHashOf(result.state.installId) : "unavailable";
  return {
    installHash,
    runOrdinalBucket: result.recovered ? "unavailable" : bucketOrdinal(result.state.runCount),
    isCI: isCiEnv(env),
  };
}

type ReceiptMilestone = "first_receipt" | "third_receipt" | "tenth_receipt";

function receiptMilestoneFor(count: number): ReceiptMilestone | undefined {
  if (count === 1) return "first_receipt";
  if (count === 3) return "third_receipt";
  if (count === 10) return "tenth_receipt";
  return undefined;
}

/** Increments the local receipt counter, records the receipt event, and fires once-only receipt milestones. */
export async function noteReceiptGenerated(
  input: Omit<RecordReceiptGeneratedInput, "receiptOrdinal">,
  command = input.surface,
  now: number = Date.now(),
): Promise<void> {
  let milestone: ReceiptMilestone | undefined;
  const result = await updateStateWithMeta((state) => {
    state.receiptCount += 1;
    const next = receiptMilestoneFor(state.receiptCount);
    if (next && !state.milestones[next]) {
      state.milestones[next] = true;
      milestone = next;
    }
  });

  recordReceiptGenerated({
    ...input,
    receiptOrdinal: result && !result.recovered ? result.state.receiptCount : undefined,
  });

  if (result && !result.recovered && milestone) {
    recordActivationMilestone({ milestone, command, firstRunAt: result.state.firstRunAt, now });
  }
}

export async function noteMilestone(milestone: MilestoneValue, command: string, now: number = Date.now()): Promise<void> {
  let shouldRecord = false;
  const result = await updateStateWithMeta((state) => {
    if (!state.milestones[milestone]) {
      state.milestones[milestone] = true;
      shouldRecord = true;
    }
  });
  if (result && shouldRecord) {
    recordActivationMilestone({ milestone, command, firstRunAt: result.state.firstRunAt, now });
  }
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
