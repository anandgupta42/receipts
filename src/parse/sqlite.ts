import { spawnSync } from "node:child_process";

/** Minimal read-only SQLite access. `all(sql)` returns plain row objects. */
export interface SqliteReader {
  all(sql: string): Record<string, unknown>[];
  close(): void;
}

let sqliteWarningFilterInstalled = false;
let sqlite3ProbeUsable: boolean | undefined;

type WarningConstructor = (...args: never[]) => unknown;
type EmitWarningArgs =
  | [warning: string | Error]
  | [warning: string | Error, type: string]
  | [warning: string | Error, type: string, code: string]
  | [warning: string | Error, type: string, code: string, ctor: WarningConstructor]
  | [warning: string | Error, options: NodeJS.EmitWarningOptions];
type EmitWarningDelegate = (...args: EmitWarningArgs) => void;

function warningMessage(warning: string | Error): string {
  return warning instanceof Error ? warning.message : warning;
}

function warningType(warning: string | Error, typeOrOptions?: string | NodeJS.EmitWarningOptions): string | undefined {
  if (warning instanceof Error) return warning.name;
  if (typeof typeOrOptions === "string") return typeOrOptions;
  return typeOrOptions?.type;
}

function isNodeSqliteExperimentalWarning(
  warning: string | Error,
  typeOrOptions?: string | NodeJS.EmitWarningOptions,
): boolean {
  return warningType(warning, typeOrOptions) === "ExperimentalWarning" && warningMessage(warning).includes("SQLite");
}

function installNodeSqliteWarningFilter(): void {
  if (sqliteWarningFilterInstalled) return;
  sqliteWarningFilterInstalled = true;

  const emitWarning = process.emitWarning.bind(process) as unknown as EmitWarningDelegate;
  process.emitWarning = ((...args: EmitWarningArgs): void => {
    const [warning, typeOrOptions] = args;
    if (isNodeSqliteExperimentalWarning(warning, typeOrOptions)) return;
    emitWarning(...args);
  }) as typeof process.emitWarning;
}

/**
 * Node's built-in SQLite is preferred when present: in-process reads avoid a
 * spawn per query. Node ≥22.13 loads it unflagged but emits an ExperimentalWarning
 * that embeds the PID; suppressing only that SQLite warning preserves I1/I5
 * byte-determinism and keeps user stderr clean. The sqlite3 CLI remains the
 * portable fallback for Node without node:sqlite. Opened read-only — we never
 * write to the agent's DB.
 */
async function tryNodeSqlite(dbPath: string): Promise<SqliteReader | null> {
  try {
    installNodeSqliteWarningFilter();
    const { DatabaseSync } = (await import("node:sqlite")) as {
      DatabaseSync: new (
        path: string,
        opts?: { readOnly?: boolean },
      ) => { prepare(sql: string): { all(): unknown[] }; close(): void };
    };
    const db = new DatabaseSync(dbPath, { readOnly: true });
    return {
      // Same error contract as the CLI fallback: a failing query (missing
      // table, schema drift) yields [] on every runtime, never a throw.
      all: (sql) => {
        try {
          return db.prepare(sql).all() as Record<string, unknown>[];
        } catch {
          return [];
        }
      },
      close: () => db.close(),
    };
  } catch {
    return null;
  }
}

/** The `sqlite3` CLI in read-only JSON mode — the portable fallback (no npm dep). */
function trySqlite3Cli(dbPath: string): SqliteReader | null {
  if (sqlite3ProbeUsable === undefined) {
    const probe = spawnSync("sqlite3", ["-version"], { encoding: "utf8" });
    sqlite3ProbeUsable = !probe.error && probe.status === 0;
  }
  if (!sqlite3ProbeUsable) {
    return null;
  }
  return {
    all: (sql) => {
      const r = spawnSync("sqlite3", ["-readonly", "-json", dbPath, sql], {
        encoding: "utf8",
        maxBuffer: 1 << 29, // bubbles can be large
      });
      if (r.status !== 0 || !r.stdout || !r.stdout.trim()) {
        return [];
      }
      try {
        return JSON.parse(r.stdout) as Record<string, unknown>[];
      } catch {
        return [];
      }
    },
    close: () => {},
  };
}

// Test-only: pin which backend openReadOnly uses. CI runs a single Node version
// (node:sqlite present), so the sqlite3-CLI fallback is otherwise never reached;
// pinning "cli" lets a test drive the full parse→render pipeline through it and
// prove the receipt is byte-identical to the node:sqlite path. null = normal
// auto-select; product code never sets this.
let forcedReaderForTests: "cli" | "node" | null = null;
export function __setForcedReaderForTests(reader: "cli" | "node" | null): void {
  forcedReaderForTests = reader;
}

/**
 * Open a SQLite database read-only. Prefers node:sqlite for in-process reads and
 * falls back to the sqlite3 CLI on runtimes where node:sqlite is unavailable.
 * Returns null when neither is usable — callers degrade gracefully (e.g. the
 * Cursor adapter reports not-detected).
 */
export async function openReadOnly(dbPath: string): Promise<SqliteReader | null> {
  if (forcedReaderForTests === "cli") return trySqlite3Cli(dbPath);
  if (forcedReaderForTests === "node") return await tryNodeSqlite(dbPath);
  return (await tryNodeSqlite(dbPath)) ?? trySqlite3Cli(dbPath);
}

/**
 * Test-only seam: each reader backend, exposed so the sqlite3-CLI fallback keeps
 * direct unit coverage (real-data reads + the `[]`-on-error contract) alongside
 * the end-to-end render parity that `__setForcedReaderForTests` enables. Not for
 * product use.
 */
export const __sqliteReadersForTests = { tryNodeSqlite, trySqlite3Cli };
