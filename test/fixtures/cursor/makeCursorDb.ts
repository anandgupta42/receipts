// Synthetic Cursor `state.vscdb` builder for degraded-mode fixture testing.
//
// Cursor's own SQLite schema (`cursorDiskKV` key/value table) does not
// record which model served a turn, and only exposes a total token count —
// no input/output split. Adapters for Cursor are therefore expected to run
// in "degraded mode": priced sessions render as token-only (no `$`, per I2),
// and the model column renders "unknown".
//
// All content below is fabricated for this fixture (fake composerId, fake
// file paths, fake narrative) — nothing here is copied from a real Cursor
// session.
import { DatabaseSync } from "node:sqlite";

export interface MakeCursorDbOptions {
  /** Absolute path to write the sqlite file to. */
  dbPath: string;
}

/**
 * Builds a minimal, degraded-mode Cursor `state.vscdb` fixture and writes it
 * to `dbPath`. Returns the synthetic `composerId` used, so callers can
 * assert against it.
 */
export function makeCursorDb({ dbPath }: MakeCursorDbOptions): string {
  const composerId = "f0e1d2c3-0000-4000-8000-cafef00dbabe";
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE cursorDiskKV (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const insert = db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");

  // A stray "null"-string row — real Cursor DBs occasionally contain these;
  // the adapter must skip rows whose value is the literal string "null"
  // rather than crashing on JSON.parse("null") returning a non-object.
  insert.run("composerData:00000000-0000-4000-8000-000000000000", "null");

  const bubbleIds = ["bubble-0001", "bubble-0002", "bubble-0003", "bubble-0004"];

  const composerData = {
    composerId,
    name: "Add a rate limiter to the API gateway",
    // Degraded mode: no per-turn model id is ever recorded by Cursor itself.
    fullConversationHeadersOnly: bubbleIds.map((id, i) => ({
      bubbleId: id,
      type: i % 2 === 0 ? 1 : 2, // 1 = user, 2 = assistant (Cursor's own enum)
    })),
    createdAt: Date.parse("2026-06-27T10:00:00.000Z"),
    lastUpdatedAt: Date.parse("2026-06-27T10:04:30.000Z"),
    // Session-level totals-only token count — the only shape
    // src/parse/cursor.ts's mapTokens actually reads (composerData.tokenCount
    // .{inputTokens,outputTokens}); per-bubble tokenCount below is never
    // consulted for session totals, only kept as realistic per-turn noise.
    tokenCount: { inputTokens: 1900, outputTokens: 268 },
  };
  insert.run(`composerData:${composerId}`, JSON.stringify(composerData));

  let t = Date.parse("2026-06-27T10:00:00.000Z");
  const nextTs = () => (t += 15_000);

  const bubbles: Record<string, unknown> = {
    [bubbleIds[0]]: {
      bubbleId: bubbleIds[0],
      type: 1,
      text: "Add a token-bucket rate limiter in front of the API gateway routes in src/gateway/router.ts.",
      createdAt: nextTs(),
    },
    [bubbleIds[1]]: {
      bubbleId: bubbleIds[1],
      type: 2,
      text: "I'll add a token-bucket limiter middleware and wire it into the router.",
      createdAt: nextTs(),
      // Modern Cursor tool-call shape: string-named tool.
      toolFormerData: {
        tool: "edit_file",
        name: "edit_file",
        rawArgs: JSON.stringify({
          target_file: "src/gateway/rateLimiter.ts",
          instructions: "Create a token-bucket rate limiter middleware.",
        }),
        status: "completed",
      },
      // Degraded mode: total-only token count, no input/output split.
      tokenCount: { totalTokens: 812 },
    },
    [bubbleIds[2]]: {
      bubbleId: bubbleIds[2],
      type: 1,
      text: "Looks good — can you also run the gateway tests to confirm nothing broke?",
      createdAt: nextTs(),
    },
    [bubbleIds[3]]: {
      bubbleId: bubbleIds[3],
      type: 2,
      text: "Ran the gateway test suite and it's all passing with the new rate limiter in place.",
      createdAt: nextTs(),
      // Legacy Cursor tool-call shape: numeric enum instead of a name string.
      toolFormerData: {
        tool: 7, // legacy numeric enum observed in older Cursor DBs for "run_terminal_cmd"
        rawArgs: JSON.stringify({ command: "pnpm test gateway" }),
        status: "completed",
      },
      tokenCount: { totalTokens: 456 },
    },
  };

  for (const [bubbleId, data] of Object.entries(bubbles)) {
    insert.run(`bubbleId:${composerId}:${bubbleId}`, JSON.stringify(data));
  }

  db.close();
  return composerId;
}
