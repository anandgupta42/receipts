import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentSource } from "../parse/types.js";
import {
  COMMAND_VALUES,
  type AgentTypeValue,
  type CommandValue,
  type CountBucketValue,
  type DurationBucketValue,
  type ErrorClassValue,
  type InstallAgeBucketValue,
  type OrdinalBucketValue,
  type OsValue,
} from "./schemas.js";

/**
 * Derives every telemetry field from raw runtime data (errors, stack
 * traces, `process.platform`, `package.json`) so that no caller ever needs
 * to pass a raw error message, a file path, or a stack frame into a
 * telemetry event directly — the conversion to a bounded enum/regex value
 * happens once, here, and nothing else leaves this module (R3).
 */

export function toOsTelemetry(platform: NodeJS.Platform = process.platform): OsValue {
  if (platform === "darwin" || platform === "linux" || platform === "win32") {
    return platform;
  }
  return "other";
}

export function toAgentTypeTelemetry(source: AgentSource | undefined): AgentTypeValue {
  return source ?? "unknown";
}

/** Coarse duration buckets (R2) — never the raw millisecond count. */
export function bucketDuration(ms: number): DurationBucketValue {
  if (ms < 100) return "<100ms";
  if (ms < 500) return "100-500ms";
  if (ms < 2000) return "500ms-2s";
  if (ms < 10_000) return "2-10s";
  return ">10s";
}

/** Maps a CLI command name to R2's closed command enum — never the raw command line or its arguments. */
export function toCommandTelemetry(command: string): CommandValue | undefined {
  const normalized = command.trim().toLowerCase();
  return (COMMAND_VALUES as readonly string[]).includes(normalized) ? (normalized as CommandValue) : undefined;
}

/** Coarse count buckets (SPEC-0043 R3/R4) — never the raw count. */
export function bucketCount(n: number): CountBucketValue {
  if (n <= 0) return "0";
  if (n === 1) return "1";
  if (n <= 3) return "2-3";
  if (n <= 10) return "4-10";
  if (n <= 50) return "11-50";
  return ">50";
}

/** Coarse ordinal buckets (SPEC-0043 R2/R3) — `undefined` means the counter could not be trusted. */
export function bucketOrdinal(n: number | undefined): OrdinalBucketValue {
  if (n === undefined || n <= 0) return "unavailable";
  if (n === 1) return "1";
  if (n <= 3) return "2-3";
  if (n <= 10) return "4-10";
  if (n <= 50) return "11-50";
  return ">50";
}

/** Install age buckets (SPEC-0043 R5) — the raw first-run date never appears in telemetry. */
export function bucketInstallAge(firstRunAt: string | undefined, now: number | Date = Date.now()): InstallAgeBucketValue {
  if (!firstRunAt) {
    return "unavailable";
  }
  const first = Date.parse(firstRunAt);
  if (Number.isNaN(first)) {
    return "unavailable";
  }
  const nowMs = now instanceof Date ? now.getTime() : now;
  const days = Math.max(0, Math.floor((nowMs - first) / 86_400_000));
  if (days === 0) return "first_day";
  if (days <= 7) return "2-7d";
  if (days <= 30) return "8-30d";
  if (days <= 90) return "31-90d";
  return ">90d";
}

/** CI detection for R2: set-and-not-false `CI` or `GITHUB_ACTIONS` separates automation from human CLI use. */
export function isCiEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const active = (value: string | undefined): boolean => value !== undefined && value !== "" && value.toLowerCase() !== "false";
  return active(env.CI) || active(env.GITHUB_ACTIONS);
}

/**
 * Classifies an unknown thrown value into R2's small fixed error taxonomy.
 * Deliberately never reads `error.message` into the return value — only
 * `error.constructor.name`/well-known Node error codes, which are
 * themselves closed vocabularies, not free text.
 */
export function classifyError(err: unknown): ErrorClassValue {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : undefined;
  if (code === "ENOENT" || code === "EACCES" || code === "EISDIR" || code === "ENOTDIR" || code === "EMFILE") {
    return "io_error";
  }
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ENOTFOUND" || code === "ECONNRESET") {
    return "network_error";
  }
  const ctorName = err instanceof Error ? err.constructor.name : undefined;
  if (ctorName === "ZodError") {
    return "validation_error";
  }
  if (ctorName === "SyntaxError") {
    return "parse_error";
  }
  return "unknown_error";
}

let cachedPackageRoot: string | undefined;

/** Walk-up to find the package root (the directory containing `package.json`), mirroring `pricing/priceTable.ts`'s `defaultDataDir` pattern. Cached: fixed on-disk location. */
function packageRoot(): string {
  if (cachedPackageRoot) {
    return cachedPackageRoot;
  }
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "package.json"))) {
      cachedPackageRoot = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  cachedPackageRoot = dir;
  return dir;
}

/**
 * Whether an error's top stack frame originates from inside this package's
 * own installed location (a bug in aireceipts itself) versus a dependency
 * or the caller's own code. Inspects the stack trace internally but
 * returns only a boolean — the frame text itself never leaves this
 * function, so it can never appear in a telemetry payload (R3).
 */
export function isInPackage(err: unknown): boolean {
  if (!(err instanceof Error) || typeof err.stack !== "string") {
    return false;
  }
  const root = packageRoot();
  const firstFrame = err.stack.split("\n").slice(1).find((line) => line.trim().startsWith("at "));
  return firstFrame ? firstFrame.includes(root) : false;
}

let cachedCliVersion: string | undefined;

/** Reads `package.json`'s `version` field by walking up from this module's own location — same technique as {@link packageRoot}. Falls back to `"0.0.0"` (never throws) if `package.json` is missing or malformed. */
export function getCliVersion(): string {
  if (cachedCliVersion) {
    return cachedCliVersion;
  }
  try {
    const raw = readFileSync(path.join(packageRoot(), "package.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    const version = parsed && typeof parsed === "object" && "version" in parsed ? (parsed as { version?: unknown }).version : undefined;
    cachedCliVersion = typeof version === "string" && version.length > 0 ? version : "0.0.0";
  } catch {
    cachedCliVersion = "0.0.0";
  }
  return cachedCliVersion;
}
