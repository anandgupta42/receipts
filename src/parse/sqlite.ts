import { spawnSync } from "node:child_process";

/** Minimal read-only SQLite access. `all(sql)` returns plain row objects. */
export interface SqliteReader {
  all(sql: string): Record<string, unknown>[];
  close(): void;
}

/**
 * Node's built-in SQLite (Node ≥ 22.5). Available only when started with
 * `--experimental-sqlite`; otherwise the import/construct throws and we fall back
 * to the CLI. Opened read-only — we never write to the agent's DB.
 */
async function tryNodeSqlite(dbPath: string): Promise<SqliteReader | null> {
  try {
    const { DatabaseSync } = (await import("node:sqlite")) as {
      DatabaseSync: new (
        path: string,
        opts?: { readOnly?: boolean },
      ) => { prepare(sql: string): { all(): unknown[] }; close(): void };
    };
    const db = new DatabaseSync(dbPath, { readOnly: true });
    return {
      all: (sql) => db.prepare(sql).all() as Record<string, unknown>[],
      close: () => db.close(),
    };
  } catch {
    return null;
  }
}

/** The `sqlite3` CLI in read-only JSON mode — the portable fallback (no npm dep). */
function trySqlite3Cli(dbPath: string): SqliteReader | null {
  const probe = spawnSync("sqlite3", ["-version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
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

/**
 * Open a SQLite database read-only. Prefers the stable `sqlite3` CLI so normal
 * CLI/golden runs do not emit Node's process-specific experimental
 * `node:sqlite` warning; falls back to `node:sqlite` when the CLI is absent.
 * Returns null when neither is usable — callers degrade gracefully (e.g. the
 * Cursor adapter reports not-detected).
 */
export async function openReadOnly(dbPath: string): Promise<SqliteReader | null> {
  return trySqlite3Cli(dbPath) ?? (await tryNodeSqlite(dbPath));
}
