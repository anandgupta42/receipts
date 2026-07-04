import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentSource } from "../parse/types.js";
import type { AgentTypeValue, CommandClassValue, DurationBucketValue, ErrorClassValue, OsValue } from "./schemas.js";

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

/** Maps a CLI subcommand name to R2's closed 4-value taxonomy — never the raw command line or its arguments. */
export function toCommandClass(command: string): CommandClassValue {
  const normalized = command.trim().toLowerCase();
  if (normalized === "receipt" || normalized === "") {
    return "receipt";
  }
  if (normalized === "compare") {
    return "compare";
  }
  // SPEC-0042 R5 — handoff adoption must be measurable, not folded into `other`.
  if (normalized === "handoff") {
    return "handoff";
  }
  return "other";
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
