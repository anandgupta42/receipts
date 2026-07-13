import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const operations = vi.hoisted(() => ({
  opens: 0,
  closes: 0,
  statements: 0,
  bodyLoads: 0,
}));

vi.mock("../../src/parse/sqlite.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/parse/sqlite.js")>();
  return {
    ...actual,
    openReadOnly: async (dbPath: string) => {
      const reader = await actual.openReadOnly(dbPath);
      if (!reader) {
        return null;
      }
      operations.opens++;
      return {
        all: (sql: string) => {
          operations.statements++;
          const normalized = sql.replaceAll(/\s+/gu, " ").trim();
          if (/^SELECT id, (?:type, seq, )?time_created, time_updated, data FROM (?:session_message|message) WHERE session_id /u.test(normalized)) {
            operations.bodyLoads++;
          }
          return reader.all(sql);
        },
        close: () => {
          operations.closes++;
          reader.close();
        },
      };
    },
  };
});

import { OpenCodeAdapter } from "../../src/parse/opencode.js";

const fixtureRoot = path.join(process.cwd(), "test/fixtures/opencode");
const roots: string[] = [];

beforeEach(() => {
  Object.assign(operations, { opens: 0, closes: 0, statements: 0, bodyLoads: 0 });
  vi.stubEnv("OPENCODE_DB_PATH", "");
  vi.stubEnv("OPENCODE_DB", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("SPEC-0082 operation bounds", () => {
  it("opens each candidate once and loads each requested body once within the SQL cap", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "aireceipts-opencode-bounds-"));
    roots.push(root);
    copyFileSync(path.join(fixtureRoot, "clean-multi-vendor.db"), path.join(root, "sessions.db"));
    copyFileSync(path.join(fixtureRoot, "legacy-empty-session-message.db"), path.join(root, "history.db"));

    const sessions = await new OpenCodeAdapter({ root }).listSessions({ full: true });
    const candidateCount = 2;
    expect(sessions).toHaveLength(2);
    expect(operations.opens).toBe(candidateCount);
    expect(operations.closes).toBe(candidateCount);
    expect(operations.bodyLoads).toBe(sessions.length);
    expect(operations.statements).toBeLessThanOrEqual(12 * candidateCount + 10 * sessions.length + 1);
  });
});
