import { z } from "zod";

/**
 * Allowlist schemas for SPEC-0002's diagnostics-telemetry events (R2/R3).
 *
 * Every field is enum-only or a bounded-format string validated by regex —
 * there is no free-text field anywhere in this module. `.strict()` rejects
 * any payload carrying an extra key, so a caller can never smuggle an
 * unlisted field (a path, a prompt, a dollar string) past the schema by
 * attaching it under a new name. Banned forever, and structurally
 * unrepresentable here: transcript content, prompts, file paths, repo
 * names, hostnames, usernames, session IDs, dollar amounts, raw model
 * strings (I4, SPEC-0002 R3).
 */

export const OS_VALUES = ["darwin", "linux", "win32", "other"] as const;
export type OsValue = (typeof OS_VALUES)[number];

export const COMMAND_CLASS_VALUES = ["receipt", "compare", "handoff", "other"] as const;
export type CommandClassValue = (typeof COMMAND_CLASS_VALUES)[number];

export const AGENT_TYPE_VALUES = ["claude-code", "codex", "cursor", "gemini", "opencode", "unknown"] as const;
export type AgentTypeValue = (typeof AGENT_TYPE_VALUES)[number];

/** Coarse, fixed buckets — never the raw millisecond count, which could be fingerprint-able alongside other signals. */
export const DURATION_BUCKET_VALUES = ["<100ms", "100-500ms", "500ms-2s", "2-10s", ">10s"] as const;
export type DurationBucketValue = (typeof DURATION_BUCKET_VALUES)[number];

/** A small, fixed taxonomy — never `error.message` or `error.name` verbatim, both of which can carry a file path or other identifying text. */
export const ERROR_CLASS_VALUES = [
  "parse_error",
  "io_error",
  "network_error",
  "validation_error",
  "unknown_error",
] as const;
export type ErrorClassValue = (typeof ERROR_CLASS_VALUES)[number];

const cliVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/, "cliVersion must be a bare semver string");
const nodeMajorSchema = z.number().int().min(0).max(999);
/** SHA-256 hex digest of a structural shape descriptor — never the shape itself (see `signature.ts`). */
const signatureHashSchema = z.string().regex(/^[0-9a-f]{64}$/, "signatureHash must be a sha256 hex digest");
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
    commandClass: z.enum(COMMAND_CLASS_VALUES),
    agentType: z.enum(AGENT_TYPE_VALUES),
    durationBucket: z.enum(DURATION_BUCKET_VALUES),
    ok: z.boolean(),
    /** SPEC-0042 R5 — present only on handoff-command runs. */
    handoffFormat: z.enum(HANDOFF_FORMAT_VALUES).optional(),
  })
  .strict();
export type CliRunProperties = z.infer<typeof cliRunPropertiesSchema>;

export const cliErrorPropertiesSchema = z
  .object({
    errorClass: z.enum(ERROR_CLASS_VALUES),
    /** Same bounded enum as `cli_run`'s `commandClass` — never the raw command line (R2). */
    command: z.enum(COMMAND_CLASS_VALUES),
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

/** Exactly three event names exist (R2) — this array is the single source of truth other modules and tests assert against. */
export const EVENT_NAMES = ["cli_run", "cli_error", "parse_failure"] as const;
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
export type TelemetryEvent = CliRunEvent | CliErrorEvent | ParseFailureEvent;

/** `event.name` → its properties schema, exhaustive over `EVENT_NAMES`. */
export const PROPERTIES_SCHEMA_BY_EVENT_NAME = {
  cli_run: cliRunPropertiesSchema,
  cli_error: cliErrorPropertiesSchema,
  parse_failure: parseFailurePropertiesSchema,
} as const satisfies Record<EventName, z.ZodTypeAny>;

/** Validates a full envelope (name + properties) against its schema. Never throws — returns `false` on any mismatch, including an unrecognized `name`. */
export function validateEvent(event: TelemetryEvent): boolean {
  const schema = PROPERTIES_SCHEMA_BY_EVENT_NAME[event.name] as z.ZodTypeAny | undefined;
  if (!schema) {
    return false;
  }
  return schema.safeParse(event.properties).success;
}
