// SPEC-0075 R2 — persistent statusline item order. This mirrors the existing
// `~/.aireceipts` config convention: resolve the home at call time, validate a
// closed shape, and return a typed failure instead of throwing.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { SEGMENT_NAMES, type SegmentName } from "./statuslineSegments.js";

export interface StatuslineFormatConfig {
  items: SegmentName[];
}

export type StatuslineFormatConfigLoadResult =
  | { status: "absent" }
  | { status: "invalid"; reason: string }
  | { status: "ok"; config: StatuslineFormatConfig };

/** Resolution order: explicit home, `AIRECEIPTS_HOME`, then the real home. */
export function statuslineFormatConfigPath(homeOverride?: string): string {
  return join(homeOverride ?? process.env.AIRECEIPTS_HOME ?? homedir(), ".aireceipts", "statusline.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only `{ items: SegmentName[] }` is accepted; duplicates and order stay literal. */
export function validateStatuslineFormatConfig(
  parsed: unknown,
): { ok: true; config: StatuslineFormatConfig } | { ok: false; reason: string } {
  if (!isRecord(parsed)) {
    return { ok: false, reason: "statusline.json must be a JSON object" };
  }
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== "items") {
    return { ok: false, reason: 'statusline.json must contain only an "items" array' };
  }
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    return { ok: false, reason: "items must be a non-empty array" };
  }
  const items: SegmentName[] = [];
  for (const item of parsed.items) {
    if (typeof item !== "string" || !(SEGMENT_NAMES as readonly string[]).includes(item)) {
      const shown = typeof item === "string" ? JSON.stringify(item) : JSON.stringify(item) ?? String(item);
      return { ok: false, reason: `unknown statusline item ${shown} (valid: ${SEGMENT_NAMES.join(", ")})` };
    }
    items.push(item as SegmentName);
  }
  return { ok: true, config: { items } };
}

/** Load `statusline.json` from an optional exact path seam. Never throws. */
export async function loadStatuslineFormatConfig(
  path: string = statuslineFormatConfigPath(),
): Promise<StatuslineFormatConfigLoadResult> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "absent" };
    }
    return { status: "invalid", reason: "could not read statusline.json" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", reason: "statusline.json is not valid JSON" };
  }
  const validated = validateStatuslineFormatConfig(parsed);
  return validated.ok ? { status: "ok", config: validated.config } : { status: "invalid", reason: validated.reason };
}
