import { z } from "zod";
import { TEMPLATE_NAMES } from "../receipt/blocks.js";

/**
 * Allowlist schemas for SPEC-0002/SPEC-0043 telemetry events (R1-R5).
 *
 * Every field is enum-only, boolean, bucketed, or a bounded-format hash. There
 * is no free-text field anywhere in this module. `.strict()` rejects any payload
 * carrying an extra key, so a caller can never smuggle a path, prompt, raw count,
 * timestamp, or dollar string under a new name. Banned forever, and structurally
 * unrepresentable here: transcript content, prompts, file paths, repo names,
 * hostnames, usernames, session IDs, dollar amounts, raw counts, raw timestamps,
 * and raw model strings (I4, SPEC-0002 R3, SPEC-0043 R9).
 */

export const OS_VALUES = ["darwin", "linux", "win32", "other"] as const;
export type OsValue = (typeof OS_VALUES)[number];

export const COMMAND_VALUES = [
  "backfill",
  "benchmark",
  "check-budget",
  "compare",
  "demo",
  "handoff",
  "help",
  "install-hook",
  "list",
  "methodology",
  "mini",
  "pr",
  "quota",
  "receipt",
  "stats",
  "statusline",
  "telemetry-show",
  "templates",
  "uninstall-hook",
  "version",
  "week",
] as const;
export type CommandValue = (typeof COMMAND_VALUES)[number];

export const AGENT_TYPE_VALUES = ["claude-code", "codex", "cursor", "gemini", "opencode", "unknown"] as const;
export type AgentTypeValue = (typeof AGENT_TYPE_VALUES)[number];

/** Coarse, fixed buckets — never the raw millisecond count, which could be fingerprint-able alongside other signals. */
export const DURATION_BUCKET_VALUES = ["<100ms", "100-500ms", "500ms-2s", "2-10s", ">10s"] as const;
export type DurationBucketValue = (typeof DURATION_BUCKET_VALUES)[number];

export const COUNT_BUCKET_VALUES = ["0", "1", "2-3", "4-10", "11-50", ">50"] as const;
export type CountBucketValue = (typeof COUNT_BUCKET_VALUES)[number];

export const ORDINAL_BUCKET_VALUES = ["1", "2-3", "4-10", "11-50", ">50", "unavailable"] as const;
export type OrdinalBucketValue = (typeof ORDINAL_BUCKET_VALUES)[number];

export const INSTALL_AGE_BUCKET_VALUES = ["first_day", "2-7d", "8-30d", "31-90d", ">90d", "unavailable"] as const;
export type InstallAgeBucketValue = (typeof INSTALL_AGE_BUCKET_VALUES)[number];

/** A small, fixed taxonomy — never `error.message` or `error.name` verbatim, both of which can carry a file path or other identifying text. */
export const ERROR_CLASS_VALUES = [
  "parse_error",
  "io_error",
  "network_error",
  "validation_error",
  "unknown_error",
] as const;
export type ErrorClassValue = (typeof ERROR_CLASS_VALUES)[number];

export const RESULT_VALUES = [
  "success",
  "no_data",
  "invalid_args",
  "declined",
  "external_missing",
  "external_failed",
  "write_failed",
  "internal_error",
] as const;
export type ResultValue = (typeof RESULT_VALUES)[number];

export const OUTPUT_MODE_VALUES = ["text", "json", "csv", "svg", "png", "markdown"] as const;
export type OutputModeValue = (typeof OUTPUT_MODE_VALUES)[number];

export const RECEIPT_SURFACE_VALUES = ["receipt", "compare", "mini", "pr"] as const;
export type ReceiptSurfaceValue = (typeof RECEIPT_SURFACE_VALUES)[number];

export const EXPORT_SURFACE_VALUES = ["receipt", "compare", "week", "list", "pr", "backfill"] as const;
export type ExportSurfaceValue = (typeof EXPORT_SURFACE_VALUES)[number];

export const EXPORT_FORMAT_VALUES = ["json", "csv_session", "csv_tool", "svg", "png", "markdown", "html", "text"] as const;
export type ExportFormatValue = (typeof EXPORT_FORMAT_VALUES)[number];

export const TEMPLATE_TELEMETRY_VALUES = [...TEMPLATE_NAMES, "none"] as const;
export type TemplateTelemetryValue = (typeof TEMPLATE_TELEMETRY_VALUES)[number];

export const PRICED_ROW_COVERAGE_VALUES = ["none", "some", "all"] as const;
export type PricedRowCoverageValue = (typeof PRICED_ROW_COVERAGE_VALUES)[number];

export const MILESTONE_VALUES = [
  "first_run",
  "first_receipt",
  "third_receipt",
  "tenth_receipt",
  "first_export",
  "first_compare",
  "first_week",
  "first_hook_install",
  "first_pr",
  "first_pr_post",
  "first_artifact",
] as const;
export type MilestoneValue = (typeof MILESTONE_VALUES)[number];

export const INTEGRATION_VALUES = ["statusline", "quota"] as const;
export type IntegrationValue = (typeof INTEGRATION_VALUES)[number];

export const INPUT_MODE_VALUES = ["stdin_payload", "disk_fallback", "none"] as const;
export type InputModeValue = (typeof INPUT_MODE_VALUES)[number];

export const PR_MODE_VALUES = ["dry_run", "post"] as const;
export type PrModeValue = (typeof PR_MODE_VALUES)[number];

export const STEP_RESULT_VALUES = ["success", "failed", "skipped"] as const;
export type StepResultValue = (typeof STEP_RESULT_VALUES)[number];

export const HOOK_OPERATION_VALUES = ["install", "uninstall"] as const;
export type HookOperationValue = (typeof HOOK_OPERATION_VALUES)[number];

export const PROMPT_OUTCOME_VALUES = ["accepted", "declined", "not_prompted"] as const;
export type PromptOutcomeValue = (typeof PROMPT_OUTCOME_VALUES)[number];

const cliVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/, "cliVersion must be a bare semver string");
const nodeMajorSchema = z.number().int().min(0).max(999);
/** SHA-256 hex digest of a structural shape descriptor — never the shape itself (see `signature.ts`). */
const signatureHashSchema = z.string().regex(/^[0-9a-f]{64}$/, "signatureHash must be a sha256 hex digest");
/** SHA-256 hex digest of SPEC-0043's random install id salt, or the no-id sentinel when unavailable. */
const installHashSchema = z.union([
  z.string().regex(/^[0-9a-f]{64}$/, "installHash must be a sha256 hex digest"),
  z.literal("unavailable"),
]);
/** An internal per-adapter constant (e.g. `"1"`), not anything read from a transcript. */
const adapterVersionSchema = z.string().regex(/^[a-zA-Z0-9_.-]{1,32}$/, "adapterVersion must be a short opaque token");

/** SPEC-0042 R5 — emission mode of the handoff command only; enum, never content. */
export const HANDOFF_FORMAT_VALUES = ["text", "json"] as const;
export type HandoffFormatValue = (typeof HANDOFF_FORMAT_VALUES)[number];

export const cliRunPropertiesSchema = z
  .object({
    cliVersion: cliVersionSchema,
    os: z.enum(OS_VALUES),
    nodeMajor: nodeMajorSchema,
    commandClass: z.enum(COMMAND_VALUES),
    agentType: z.enum(AGENT_TYPE_VALUES),
    durationBucket: z.enum(DURATION_BUCKET_VALUES),
    ok: z.boolean(),
    isCI: z.boolean(),
    installHash: installHashSchema,
    runOrdinalBucket: z.enum(ORDINAL_BUCKET_VALUES),
    /** SPEC-0042 R5 — present only on handoff-command runs. */
    handoffFormat: z.enum(HANDOFF_FORMAT_VALUES).optional(),
  })
  .strict();
export type CliRunProperties = z.infer<typeof cliRunPropertiesSchema>;

export const cliErrorPropertiesSchema = z
  .object({
    errorClass: z.enum(ERROR_CLASS_VALUES),
    /** Same bounded enum as `cli_run.commandClass` — never the raw command line (R2). */
    command: z.enum(COMMAND_VALUES),
    agentType: z.enum(AGENT_TYPE_VALUES),
    inPackage: z.boolean(),
  })
  .strict();
export type CliErrorProperties = z.infer<typeof cliErrorPropertiesSchema>;

export const parseFailurePropertiesSchema = z
  .object({
    agentType: z.enum(AGENT_TYPE_VALUES),
    adapterVersion: adapterVersionSchema,
    signatureHash: signatureHashSchema,
  })
  .strict();
export type ParseFailureProperties = z.infer<typeof parseFailurePropertiesSchema>;

export const receiptGeneratedPropertiesSchema = z
  .object({
    surface: z.enum(RECEIPT_SURFACE_VALUES),
    agentType: z.enum(AGENT_TYPE_VALUES),
    multiAgent: z.boolean(),
    outputMode: z.enum(OUTPUT_MODE_VALUES),
    template: z.enum(TEMPLATE_TELEMETRY_VALUES),
    pricedRowCoverage: z.enum(PRICED_ROW_COVERAGE_VALUES),
    hasStuckLoopWaste: z.boolean(),
    hasTrivialSpansWaste: z.boolean(),
    hasContextThrashWaste: z.boolean(),
    hasPriceDelta: z.boolean(),
    /** SPEC-0054 R8 — the receipt rendered with the opt-in `--details` section (boolean, never content). */
    detailsView: z.boolean(),
    turnCountBucket: z.enum(COUNT_BUCKET_VALUES),
    toolCallCountBucket: z.enum(COUNT_BUCKET_VALUES),
    receiptOrdinalBucket: z.enum(ORDINAL_BUCKET_VALUES),
  })
  .strict();
export type ReceiptGeneratedProperties = z.infer<typeof receiptGeneratedPropertiesSchema>;

export const exportGeneratedPropertiesSchema = z
  .object({
    surface: z.enum(EXPORT_SURFACE_VALUES),
    format: z.enum(EXPORT_FORMAT_VALUES),
    wroteFile: z.boolean(),
    result: z.enum(RESULT_VALUES),
  })
  .strict();
export type ExportGeneratedProperties = z.infer<typeof exportGeneratedPropertiesSchema>;

export const prFlowCompletedPropertiesSchema = z
  .object({
    mode: z.enum(PR_MODE_VALUES),
    artifactRequested: z.boolean(),
    shareRequested: z.boolean(),
    contributorCountBucket: z.enum(COUNT_BUCKET_VALUES),
    commentResult: z.enum(STEP_RESULT_VALUES),
    artifactResult: z.enum(STEP_RESULT_VALUES),
    shareResult: z.enum(STEP_RESULT_VALUES),
    /** SPEC-0059 R8 — the body carried the handoff section (rendering rate, never engagement). */
    handoffSectionIncluded: z.boolean(),
    result: z.enum(RESULT_VALUES),
  })
  .strict();
export type PrFlowCompletedProperties = z.infer<typeof prFlowCompletedPropertiesSchema>;

export const hookConfiguredPropertiesSchema = z
  .object({
    operation: z.enum(HOOK_OPERATION_VALUES),
    promptOutcome: z.enum(PROMPT_OUTCOME_VALUES),
    result: z.enum(RESULT_VALUES),
  })
  .strict();
export type HookConfiguredProperties = z.infer<typeof hookConfiguredPropertiesSchema>;

export const integrationSurfaceRenderedPropertiesSchema = z
  .object({
    integration: z.enum(INTEGRATION_VALUES),
    inputMode: z.enum(INPUT_MODE_VALUES),
    payloadValid: z.boolean(),
    result: z.enum(RESULT_VALUES),
  })
  .strict();
export type IntegrationSurfaceRenderedProperties = z.infer<typeof integrationSurfaceRenderedPropertiesSchema>;

export const activationMilestonePropertiesSchema = z
  .object({
    milestone: z.enum(MILESTONE_VALUES),
    command: z.enum(COMMAND_VALUES),
    installAgeBucket: z.enum(INSTALL_AGE_BUCKET_VALUES),
  })
  .strict();
export type ActivationMilestoneProperties = z.infer<typeof activationMilestonePropertiesSchema>;

/** Exactly nine event names exist (SPEC-0043 R1) — this array is the single source of truth other modules and tests assert against. */
export const EVENT_NAMES = [
  "cli_run",
  "cli_error",
  "parse_failure",
  "receipt_generated",
  "export_generated",
  "pr_flow_completed",
  "hook_configured",
  "integration_surface_rendered",
  "activation_milestone",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export interface CliRunEvent {
  name: "cli_run";
  properties: CliRunProperties;
}
export interface CliErrorEvent {
  name: "cli_error";
  properties: CliErrorProperties;
}
export interface ParseFailureEvent {
  name: "parse_failure";
  properties: ParseFailureProperties;
}
export interface ReceiptGeneratedEvent {
  name: "receipt_generated";
  properties: ReceiptGeneratedProperties;
}
export interface ExportGeneratedEvent {
  name: "export_generated";
  properties: ExportGeneratedProperties;
}
export interface PrFlowCompletedEvent {
  name: "pr_flow_completed";
  properties: PrFlowCompletedProperties;
}
export interface HookConfiguredEvent {
  name: "hook_configured";
  properties: HookConfiguredProperties;
}
export interface IntegrationSurfaceRenderedEvent {
  name: "integration_surface_rendered";
  properties: IntegrationSurfaceRenderedProperties;
}
export interface ActivationMilestoneEvent {
  name: "activation_milestone";
  properties: ActivationMilestoneProperties;
}
export type TelemetryEvent =
  | CliRunEvent
  | CliErrorEvent
  | ParseFailureEvent
  | ReceiptGeneratedEvent
  | ExportGeneratedEvent
  | PrFlowCompletedEvent
  | HookConfiguredEvent
  | IntegrationSurfaceRenderedEvent
  | ActivationMilestoneEvent;

/** `event.name` → its properties schema, exhaustive over `EVENT_NAMES`. */
export const PROPERTIES_SCHEMA_BY_EVENT_NAME = {
  cli_run: cliRunPropertiesSchema,
  cli_error: cliErrorPropertiesSchema,
  parse_failure: parseFailurePropertiesSchema,
  receipt_generated: receiptGeneratedPropertiesSchema,
  export_generated: exportGeneratedPropertiesSchema,
  pr_flow_completed: prFlowCompletedPropertiesSchema,
  hook_configured: hookConfiguredPropertiesSchema,
  integration_surface_rendered: integrationSurfaceRenderedPropertiesSchema,
  activation_milestone: activationMilestonePropertiesSchema,
} as const satisfies Record<EventName, z.ZodTypeAny>;

/** Validates a full envelope (name + properties) against its schema. Never throws — returns `false` on any mismatch, including an unrecognized `name`. */
export function validateEvent(event: TelemetryEvent): boolean {
  const schema = PROPERTIES_SCHEMA_BY_EVENT_NAME[event.name] as z.ZodTypeAny | undefined;
  if (!schema) {
    return false;
  }
  return schema.safeParse(event.properties).success;
}
