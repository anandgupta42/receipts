import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { PriceTable } from "./types.js";

/**
 * Load `<dataDir>/<vendor>.json`. Never throws — a missing file, unreadable
 * path, or malformed/misshapen JSON all resolve to `null` (I1: never crash
 * on bad or absent input; callers degrade to tokens-only mode).
 */
export async function loadPriceTable(vendor: string, dataDir: string): Promise<PriceTable | null> {
  try {
    const raw = await readFile(path.join(dataDir, `${vendor}.json`), "utf8");
    const parsed = JSON.parse(raw) as Partial<PriceTable>;
    if (parsed && typeof parsed === "object" && typeof parsed.vendor === "string" && parsed.models && typeof parsed.models === "object") {
      return parsed as PriceTable;
    }
    return null;
  } catch {
    return null;
  }
}

let cachedDefaultDataDir: string | undefined;

/**
 * Best-effort `data/prices` directory for callers that don't pass an
 * explicit `dataDir` (the CLI): walk up from this module's own location
 * looking for a `data/prices` sibling. Works both from `src/` (vitest) and
 * from `dist/` (the built package — `data/prices` ships alongside `dist/`
 * per `package.json`'s `files` array). Cached: the result only depends on
 * this module's fixed on-disk location, never on process CWD.
 */
export function defaultDataDir(): string {
  if (cachedDefaultDataDir) {
    return cachedDefaultDataDir;
  }
  const start = path.dirname(fileURLToPath(import.meta.url));
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "data", "prices");
    if (existsSync(candidate)) {
      cachedDefaultDataDir = candidate;
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  // Not found — return a plausible path anyway. `loadPriceTable` degrades to
  // `null` gracefully on a missing directory (I1), it never throws here.
  cachedDefaultDataDir = path.join(start, "..", "..", "data", "prices");
  return cachedDefaultDataDir;
}
