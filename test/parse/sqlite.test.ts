// The sqlite3-CLI fallback reader used to be covered only implicitly, by the
// Node 20 CI job (no node:sqlite → fall back to the CLI). With CI down to a
// single Node version that ships node:sqlite, that path would go dark. This
// covers it directly at two levels:
//   1. the reader itself — real-data reads + the []-on-error contract;
//   2. end-to-end — the full opencode parse→render pipeline driven through the
//      CLI reader must produce a receipt byte-identical to the node:sqlite path
//      (the equivalence the Node 20-vs-22 CI split used to guarantee).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { OpenCodeAdapter } from "../../src/parse/opencode.js";
import { __setForcedReaderForTests, __sqliteReadersForTests } from "../../src/parse/sqlite.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { renderReceipt } from "../../src/receipt/render.js";

const { tryNodeSqlite, trySqlite3Cli } = __sqliteReadersForTests;

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/opencode");
const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/prices");
const fixtures = [
  { db: "clean-multi-vendor.db", sessionId: "ses_clean" },
  { db: "loop-shell-3x.db", sessionId: "ses_loop" },
] as const;

const sqlite3Available = (() => {
  const probe = spawnSync("sqlite3", ["-version"], { encoding: "utf8" });
  return !probe.error && probe.status === 0;
})();

// The forks pool runs with --experimental-sqlite, so node:sqlite is normally
// present — but detect rather than assume, so this file never hard-fails a
// runtime that lacks it.
const nodeSqliteReader = await tryNodeSqlite(path.join(fixturesDir, fixtures[0].db));
const nodeSqliteAvailable = nodeSqliteReader !== null;
nodeSqliteReader?.close();

describe.skipIf(!sqlite3Available)("sqlite3 CLI fallback reader", () => {
  for (const { db, sessionId } of fixtures) {
    const dbPath = path.join(fixturesDir, db);

    it(`reads real rows from ${db}`, () => {
      const reader = trySqlite3Cli(dbPath);
      expect(reader).not.toBeNull();
      try {
        expect(reader!.all("SELECT id FROM session ORDER BY id")).toEqual([{ id: sessionId }]);
      } finally {
        reader!.close();
      }
    });
  }

  it("returns [] for a failing query — same contract as node:sqlite", () => {
    const reader = trySqlite3Cli(path.join(fixturesDir, fixtures[0].db));
    try {
      expect(reader!.all("SELECT * FROM does_not_exist")).toEqual([]);
    } finally {
      reader!.close();
    }
  });
});

// Renders the full opencode receipt through a pinned reader — exercises the real
// adapter SQL (json_extract/json_each aggregates, message loading), not just a
// bare row read.
async function renderVia(reader: "cli" | "node", dbPath: string): Promise<string> {
  __setForcedReaderForTests(reader);
  try {
    const adapter = new OpenCodeAdapter({ dbPath });
    const session = await adapter.loadSession(dbPath);
    if (!session) throw new Error(`loadSession returned null via ${reader} for ${dbPath}`);
    return renderReceipt(await buildReceiptModel(session, dataDir), { color: false });
  } finally {
    __setForcedReaderForTests(null);
  }
}

describe.skipIf(!sqlite3Available || !nodeSqliteAvailable)("receipt parity: sqlite3 CLI vs node:sqlite", () => {
  afterEach(() => __setForcedReaderForTests(null));

  for (const { db } of fixtures) {
    const dbPath = path.join(fixturesDir, db);

    it(`renders a byte-identical receipt from ${db} on both reader paths`, async () => {
      const viaNode = await renderVia("node", dbPath);
      const viaCli = await renderVia("cli", dbPath);
      expect(viaCli).toBe(viaNode);
      expect(viaCli.length).toBeGreaterThan(0);
    });
  }
});
