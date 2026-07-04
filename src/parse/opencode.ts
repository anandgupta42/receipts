import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promises as fs } from "node:fs";
import { openReadOnly, type SqliteReader } from "./sqlite.js";
import type {
  AgentSource,
  ListSessionsOptions,
  Session,
  SessionAdapter,
  SessionSummary,
  TokenUsage,
  ToolCall,
  Turn,
} from "./types.js";
import { addUsage, emptyUsage, parseTimestamp, pathExists, truncate, withTotal } from "./util.js";

/**
 * opencode stores sessions in SQLite DBs under `~/.local/share/opencode`.
 * Current observed schema (opencode v1.17.x):
 *   session              -> session metadata and aggregate token columns
 *   session_message.data -> assistant/user envelope; assistant rows carry
 *                           model, tokens, content/tool state, and time
 *
 * The local v1.17.9 install also had empty legacy `message`/`part` tables, so
 * this adapter keeps a fallback parser for that shape. The current schema is
 * preferred whenever `session_message` is present.
 *
 * R3 usage mapping: opencode exposes per-assistant-message usage, so one
 * assistant message becomes one `Turn`. `tokens.reasoning` is folded into
 * `usage.output` because this schema has no separate reasoning bucket and
 * dropping it would under-report billed output tokens. `tokens.cache.read`
 * maps to `cacheRead`; `tokens.cache.write` maps to flat `cacheCreation`.
 * opencode does not expose cache-write TTL tiers, so `cacheCreation5m` and
 * `cacheCreation1h` remain `undefined` rather than fabricated zeros.
 */

const ID_SEP = "#";

interface RawTokens {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: {
    read?: number;
    write?: number;
  };
}

interface RawMessageData {
  role?: string;
  text?: string;
  model?: string | { id?: unknown; providerID?: unknown; variant?: unknown };
  modelID?: string;
  tokens?: RawTokens;
  content?: unknown;
  time?: {
    created?: number | string;
    completed?: number | string;
  };
}

interface RawPartData {
  type?: string;
  tool?: string;
  name?: string;
  time?: {
    created?: number | string;
    ran?: number | string;
    completed?: number | string;
  };
  state?: {
    status?: string;
    input?: unknown;
    result?: unknown;
    output?: unknown;
    error?: unknown;
    time?: {
      start?: number | string;
      end?: number | string;
    };
  };
}

interface SessionRow {
  id: string;
  title?: string;
  model?: string;
  version?: string;
  directory?: string;
  path?: string;
  time_created?: number;
  time_updated?: number;
  tokens_input?: number;
  tokens_output?: number;
  tokens_reasoning?: number;
  tokens_cache_read?: number;
  tokens_cache_write?: number;
  turn_count?: number;
  tool_count?: number;
  message_input?: number;
  message_output?: number;
  message_reasoning?: number;
  message_cache_read?: number;
  message_cache_write?: number;
  first_model?: string;
}

interface MessageRow {
  id: string;
  time_created?: number;
  time_updated?: number;
  data?: string;
}

interface PartRow {
  message_id: string;
  data?: string;
}

function defaultRoot(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData/Local");
    return join(localAppData, "opencode");
  }
  return join(homedir(), ".local/share/opencode");
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function parseJsonObject<T>(value: unknown): T | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string" || !/^\s*[[{]/.test(value)) {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function numberOrZero(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function timestampOf(...values: unknown[]): number | undefined {
  for (const value of values) {
    const ts = parseTimestamp(value);
    if (ts !== undefined) {
      return ts;
    }
  }
  return undefined;
}

function mapTokens(tokens: RawTokens | undefined): TokenUsage | undefined {
  if (!tokens) {
    return undefined;
  }
  return withTotal({
    input: numberOrZero(tokens.input),
    output: numberOrZero(tokens.output) + numberOrZero(tokens.reasoning),
    cacheRead: numberOrZero(tokens.cache?.read),
    cacheCreation: numberOrZero(tokens.cache?.write),
    total: 0,
  });
}

function usageFromSessionColumns(row: SessionRow): TokenUsage {
  return withTotal({
    input: numberOrZero(row.message_input) || numberOrZero(row.tokens_input),
    output:
      (numberOrZero(row.message_output) + numberOrZero(row.message_reasoning)) ||
      (numberOrZero(row.tokens_output) + numberOrZero(row.tokens_reasoning)),
    cacheRead: numberOrZero(row.message_cache_read) || numberOrZero(row.tokens_cache_read),
    cacheCreation: numberOrZero(row.message_cache_write) || numberOrZero(row.tokens_cache_write),
    total: 0,
  });
}

function modelId(value: unknown): string | undefined {
  if (typeof value === "string" && value) {
    const parsed = parseJsonObject<{ id?: unknown }>(value);
    return typeof parsed?.id === "string" && parsed.id ? parsed.id : value;
  }
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return undefined;
}

function makeId(dbPath: string, sessionId: string): string {
  return `${dbPath}${ID_SEP}${encodeURIComponent(sessionId)}`;
}

function splitId(id: string): { dbPath: string; sessionId?: string } {
  const sep = id.lastIndexOf(ID_SEP);
  if (sep < 0) {
    return { dbPath: id };
  }
  return { dbPath: id.slice(0, sep), sessionId: decodeURIComponent(id.slice(sep + 1)) };
}

function summaryFromRow(dbPath: string, row: SessionRow): SessionSummary {
  const startedAt = timestampOf(row.time_created);
  const endedAt = timestampOf(row.time_updated);
  const model = modelId(row.first_model) ?? modelId(row.model);
  return {
    id: makeId(dbPath, row.id),
    source: "opencode",
    title: typeof row.title === "string" && row.title ? truncate(row.title) : undefined,
    model: typeof model === "string" && model ? model : undefined,
    startedAt,
    endedAt,
    totals: {
      tokens: usageFromSessionColumns(row),
      durationMs: startedAt !== undefined && endedAt !== undefined ? Math.max(0, endedAt - startedAt) : undefined,
      turnCount: numberOrZero(row.turn_count),
      toolCallCount: numberOrZero(row.tool_count),
    },
    filePath: dbPath,
    cwd: typeof row.directory === "string" && row.directory ? row.directory : undefined,
  };
}

function toToolCall(part: RawPartData): ToolCall | null {
  const name = typeof part.tool === "string" && part.tool ? part.tool : part.name;
  if (part.type !== "tool" || typeof name !== "string" || !name) {
    return null;
  }
  const rawStatus = part.state?.status;
  const status = rawStatus === "error" ? "error" : rawStatus === "completed" ? "ok" : "running";
  return {
    name,
    input: parseMaybeJson(part.state?.input),
    output: part.state?.output ?? part.state?.result ?? part.state?.error,
    status,
    ...(name === "bash" ? { shell: true } : {}),
    startedAt: timestampOf(part.state?.time?.start, part.time?.ran, part.time?.created),
    endedAt: timestampOf(part.state?.time?.end, part.time?.completed),
  };
}

function toolsFromContent(content: unknown): ToolCall[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return content
    .map((part) => (part && typeof part === "object" ? toToolCall(part as RawPartData) : null))
    .filter((call): call is ToolCall => call !== null);
}

function tableExists(db: SqliteReader, name: string): boolean {
  try {
    return db.all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${sqlString(name)} LIMIT 1`).length > 0;
  } catch {
    return false;
  }
}

function hasLegacyRows(db: SqliteReader): boolean {
  return tableExists(db, "message") && tableExists(db, "part");
}

function hasCurrentRows(db: SqliteReader, sessionId: string): boolean {
  if (!tableExists(db, "session_message")) {
    return false;
  }
  try {
    return db.all(`SELECT id FROM session_message WHERE session_id = ${sqlString(sessionId)} LIMIT 1`).length > 0;
  } catch {
    return false;
  }
}

function sessionIds(db: SqliteReader): string[] {
  return (db.all("SELECT id FROM session ORDER BY time_updated DESC, id") as unknown as Array<{ id: string }>)
    .map((row) => row.id)
    .filter((id) => typeof id === "string" && id.length > 0);
}

function newestSessionId(db: SqliteReader): string | undefined {
  return sessionIds(db)[0];
}

function summaryRowFor(db: SqliteReader, sessionId: string, hasLegacy: boolean): SessionRow | undefined {
  const where = `WHERE s.id = ${sqlString(sessionId)}`;
  const sql = hasCurrentRows(db, sessionId) || !hasLegacy ? currentSummarySql(where) : summarySql(where);
  return db.all(`${sql} LIMIT 1`)[0] as unknown as SessionRow | undefined;
}

async function openOpencodeDb(dbPath: string): Promise<SqliteReader | null> {
  if (!(await pathExists(dbPath))) {
    return null;
  }
  const db = await openReadOnly(dbPath);
  if (!db) {
    return null;
  }
  const hasCurrent = tableExists(db, "session_message");
  const hasLegacy = hasLegacyRows(db);
  if (!tableExists(db, "session") || (!hasCurrent && !hasLegacy)) {
    db.close();
    return null;
  }
  return db;
}

function currentSummarySql(where = ""): string {
  return `
    SELECT
      s.id,
      s.title,
      s.model,
      s.version,
      s.directory,
      s.path,
      s.time_created,
      s.time_updated,
      s.tokens_input,
      s.tokens_output,
      s.tokens_reasoning,
      s.tokens_cache_read,
      s.tokens_cache_write,
      (
        SELECT COUNT(*)
        FROM session_message m
        WHERE m.session_id = s.id AND m.type = 'assistant'
      ) AS turn_count,
      (
        SELECT COUNT(*)
        FROM session_message m, json_each(m.data, '$.content') c
        WHERE m.session_id = s.id AND m.type = 'assistant' AND json_extract(c.value, '$.type') = 'tool'
      ) AS tool_count,
      (
        SELECT SUM(COALESCE(json_extract(m.data, '$.tokens.input'), 0))
        FROM session_message m
        WHERE m.session_id = s.id AND m.type = 'assistant'
      ) AS message_input,
      (
        SELECT SUM(COALESCE(json_extract(m.data, '$.tokens.output'), 0))
        FROM session_message m
        WHERE m.session_id = s.id AND m.type = 'assistant'
      ) AS message_output,
      (
        SELECT SUM(COALESCE(json_extract(m.data, '$.tokens.reasoning'), 0))
        FROM session_message m
        WHERE m.session_id = s.id AND m.type = 'assistant'
      ) AS message_reasoning,
      (
        SELECT SUM(COALESCE(json_extract(m.data, '$.tokens.cache.read'), 0))
        FROM session_message m
        WHERE m.session_id = s.id AND m.type = 'assistant'
      ) AS message_cache_read,
      (
        SELECT SUM(COALESCE(json_extract(m.data, '$.tokens.cache.write'), 0))
        FROM session_message m
        WHERE m.session_id = s.id AND m.type = 'assistant'
      ) AS message_cache_write,
      (
        SELECT COALESCE(json_extract(m.data, '$.model.id'), json_extract(m.data, '$.modelID'), json_extract(m.data, '$.model'))
        FROM session_message m
        WHERE m.session_id = s.id
          AND m.type = 'assistant'
          AND COALESCE(json_extract(m.data, '$.model.id'), json_extract(m.data, '$.modelID'), json_extract(m.data, '$.model')) IS NOT NULL
        ORDER BY m.seq
        LIMIT 1
      ) AS first_model
    FROM session s
    ${where}
    ORDER BY s.time_updated DESC, s.id
  `;
}

function summarySql(where = ""): string {
  return `
    SELECT
      s.id,
      s.title,
      s.model,
      s.version,
      s.directory,
      s.path,
      s.time_created,
      s.time_updated,
      s.tokens_input,
      s.tokens_output,
      s.tokens_reasoning,
      s.tokens_cache_read,
      s.tokens_cache_write,
      (
        SELECT COUNT(*)
        FROM message m
        WHERE m.session_id = s.id AND json_extract(m.data, '$.role') = 'assistant'
      ) AS turn_count,
      (
        SELECT COUNT(*)
        FROM part p
        WHERE p.session_id = s.id AND json_extract(p.data, '$.type') = 'tool'
      ) AS tool_count,
      (
        SELECT SUM(COALESCE(json_extract(m.data, '$.tokens.input'), 0))
        FROM message m
        WHERE m.session_id = s.id AND json_extract(m.data, '$.role') = 'assistant'
      ) AS message_input,
      (
        SELECT SUM(COALESCE(json_extract(m.data, '$.tokens.output'), 0))
        FROM message m
        WHERE m.session_id = s.id AND json_extract(m.data, '$.role') = 'assistant'
      ) AS message_output,
      (
        SELECT SUM(COALESCE(json_extract(m.data, '$.tokens.reasoning'), 0))
        FROM message m
        WHERE m.session_id = s.id AND json_extract(m.data, '$.role') = 'assistant'
      ) AS message_reasoning,
      (
        SELECT SUM(COALESCE(json_extract(m.data, '$.tokens.cache.read'), 0))
        FROM message m
        WHERE m.session_id = s.id AND json_extract(m.data, '$.role') = 'assistant'
      ) AS message_cache_read,
      (
        SELECT SUM(COALESCE(json_extract(m.data, '$.tokens.cache.write'), 0))
        FROM message m
        WHERE m.session_id = s.id AND json_extract(m.data, '$.role') = 'assistant'
      ) AS message_cache_write,
      (
        SELECT json_extract(m.data, '$.modelID')
        FROM message m
        WHERE m.session_id = s.id
          AND json_extract(m.data, '$.role') = 'assistant'
          AND json_extract(m.data, '$.modelID') IS NOT NULL
        ORDER BY m.time_created, m.id
        LIMIT 1
      ) AS first_model
    FROM session s
    ${where}
    ORDER BY s.time_updated DESC, s.id
  `;
}

export class OpenCodeAdapter implements SessionAdapter {
  readonly id: AgentSource = "opencode";
  readonly label = "opencode";

  private readonly root: string;
  private readonly forcedDbPath?: string;

  constructor(opts: { root?: string; dbPath?: string } = {}) {
    this.root = opts.root ?? process.env.OPENCODE_DATA_DIR ?? defaultRoot();
    this.forcedDbPath = opts.dbPath ?? process.env.OPENCODE_DB_PATH ?? process.env.OPENCODE_DB;
  }

  roots(): string[] {
    return [this.forcedDbPath ?? this.root];
  }

  private async dbPaths(): Promise<string[]> {
    if (this.forcedDbPath) {
      return [
        this.forcedDbPath === ":memory:" || isAbsolute(this.forcedDbPath)
          ? this.forcedDbPath
          : join(this.root, this.forcedDbPath),
      ];
    }
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(this.root, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((entry) => entry.isFile() && /^opencode.*\.db$/u.test(entry.name))
      .map((entry) => join(this.root, entry.name))
      .sort();
  }

  async detect(): Promise<boolean> {
    for (const file of await this.dbPaths()) {
      const db = await openOpencodeDb(file);
      if (!db) {
        continue;
      }
      let hasSession = false;
      try {
        hasSession = db.all("SELECT id FROM session LIMIT 1").length > 0;
      } catch {
        hasSession = false;
      } finally {
        db.close();
      }
      if (hasSession) {
        return true;
      }
    }
    return false;
  }

  async listSessions(options: ListSessionsOptions = {}): Promise<SessionSummary[]> {
    const out: SessionSummary[] = [];
    for (const dbPath of await this.dbPaths()) {
      const db = await openOpencodeDb(dbPath);
      if (!db) {
        continue;
      }
      try {
        const hasLegacy = hasLegacyRows(db);
        const rows = sessionIds(db)
          .map((sessionId) => summaryRowFor(db, sessionId, hasLegacy))
          .filter((row): row is SessionRow => row !== undefined);
        const summaries = rows.map((row) => summaryFromRow(dbPath, row));
        if (!options.full) {
          out.push(...summaries);
          continue;
        }
        for (const [index, row] of rows.entries()) {
          out.push(this.loadFromDb(db, dbPath, row.id) ?? summaries[index]);
        }
      } catch {
        // A malformed DB degrades to "no sessions" for this adapter.
      } finally {
        db.close();
      }
    }
    return out;
  }

  private loadCurrent(db: SqliteReader, dbPath: string, sessionId: string | undefined): Session | null {
    const where = sessionId ? `WHERE s.id = ${sqlString(sessionId)}` : "";
    const summaryRow = db.all(`${currentSummarySql(where)} LIMIT 1`)[0] as unknown as SessionRow | undefined;
    if (!summaryRow) {
      return null;
    }
    const summary = summaryFromRow(dbPath, summaryRow);
    const sid = summaryRow.id;
    const messages = db.all(
      `SELECT id, type, seq, time_created, time_updated, data FROM session_message WHERE session_id = ${sqlString(sid)} ORDER BY seq`,
    ) as unknown as (MessageRow & { type?: string; seq?: number })[];

    const turns: Turn[] = [];
    let totalUsage = emptyUsage();
    let firstUserText: string | undefined;
    let startedAt: number | undefined;
    let endedAt: number | undefined;

    for (const row of messages) {
      const msg = parseJsonObject<RawMessageData>(row.data);
      if (!msg) {
        continue;
      }
      if (row.type === "user") {
        if (firstUserText === undefined && typeof msg.text === "string") {
          firstUserText = msg.text;
        }
        continue;
      }
      if (row.type !== "assistant") {
        continue;
      }
      const ts = timestampOf(msg.time?.created, row.time_created);
      const done = timestampOf(msg.time?.completed, row.time_updated, ts);
      if (ts !== undefined) {
        startedAt = startedAt === undefined ? ts : Math.min(startedAt, ts);
      }
      if (done !== undefined) {
        endedAt = endedAt === undefined ? done : Math.max(endedAt, done);
      }
      const usage = mapTokens(msg.tokens);
      if (usage) {
        totalUsage = addUsage(totalUsage, usage);
      }
      turns.push({
        index: turns.length,
        timestamp: ts,
        model: modelId(msg.modelID) ?? modelId(msg.model) ?? summary.model,
        usage,
        outputTokens: usage?.output,
        toolCalls: toolsFromContent(msg.content),
      });
    }

    const sessionStarted = startedAt ?? summary.startedAt;
    const sessionEnded = endedAt ?? summary.endedAt ?? sessionStarted;
    const toolCallCount = turns.reduce((sum, turn) => sum + turn.toolCalls.length, 0);
    return {
      ...summary,
      title: summary.title ?? (firstUserText ? truncate(firstUserText) : undefined),
      startedAt: sessionStarted,
      endedAt: sessionEnded,
      totals: {
        tokens: totalUsage.total > 0 ? totalUsage : summary.totals.tokens,
        durationMs:
          sessionStarted !== undefined && sessionEnded !== undefined ? Math.max(0, sessionEnded - sessionStarted) : undefined,
        turnCount: turns.length,
        toolCallCount,
      },
      turns,
    };
  }

  private loadLegacy(db: SqliteReader, dbPath: string, sessionId: string): Session | null {
    const where = `WHERE s.id = ${sqlString(sessionId)}`;
    const summaryRow = db.all(`${summarySql(where)} LIMIT 1`)[0] as unknown as SessionRow | undefined;
    if (!summaryRow) {
      return null;
    }
    const summary = summaryFromRow(dbPath, summaryRow);
    const sid = summaryRow.id;
    const messages = db.all(
      `SELECT id, time_created, time_updated, data FROM message WHERE session_id = ${sqlString(sid)} ORDER BY time_created, id`,
    ) as unknown as MessageRow[];
    const parts = db.all(
      `SELECT message_id, data FROM part WHERE session_id = ${sqlString(sid)} ORDER BY time_created, id`,
    ) as unknown as PartRow[];

    const partsByMessage = new Map<string, ToolCall[]>();
    for (const row of parts) {
      const parsed = parseJsonObject<RawPartData>(row.data);
      const call = parsed ? toToolCall(parsed) : null;
      if (!call) {
        continue;
      }
      const calls = partsByMessage.get(row.message_id) ?? [];
      calls.push(call);
      partsByMessage.set(row.message_id, calls);
    }

    const turns: Turn[] = [];
    let totalUsage = emptyUsage();
    let startedAt: number | undefined;
    let endedAt: number | undefined;

    for (const row of messages) {
      const msg = parseJsonObject<RawMessageData>(row.data);
      if (msg?.role !== "assistant") {
        continue;
      }
      const ts = timestampOf(msg.time?.created, row.time_created);
      const done = timestampOf(msg.time?.completed, row.time_updated, ts);
      if (ts !== undefined) {
        startedAt = startedAt === undefined ? ts : Math.min(startedAt, ts);
      }
      if (done !== undefined) {
        endedAt = endedAt === undefined ? done : Math.max(endedAt, done);
      }
      const usage = mapTokens(msg.tokens);
      if (usage) {
        totalUsage = addUsage(totalUsage, usage);
      }
      turns.push({
        index: turns.length,
        timestamp: ts,
        model: msg.modelID || summary.model,
        usage,
        outputTokens: usage?.output,
        toolCalls: partsByMessage.get(row.id) ?? [],
      });
    }

    const sessionStarted = startedAt ?? summary.startedAt;
    const sessionEnded = endedAt ?? summary.endedAt ?? sessionStarted;
    const toolCallCount = turns.reduce((sum, turn) => sum + turn.toolCalls.length, 0);
    return {
      ...summary,
      startedAt: sessionStarted,
      endedAt: sessionEnded,
      totals: {
        tokens: totalUsage.total > 0 ? totalUsage : summary.totals.tokens,
        durationMs:
          sessionStarted !== undefined && sessionEnded !== undefined ? Math.max(0, sessionEnded - sessionStarted) : undefined,
        turnCount: turns.length,
        toolCallCount,
      },
      turns,
    };
  }

  private loadFromDb(db: SqliteReader, dbPath: string, sessionId: string | undefined): Session | null {
    const selectedSessionId = sessionId ?? newestSessionId(db);
    if (!selectedSessionId) {
      return null;
    }
    const hasLegacy = hasLegacyRows(db);
    if (hasCurrentRows(db, selectedSessionId) || !hasLegacy) {
      return this.loadCurrent(db, dbPath, selectedSessionId);
    }
    return this.loadLegacy(db, dbPath, selectedSessionId);
  }

  async loadSession(id: string): Promise<Session | null> {
    const { dbPath, sessionId } = splitId(id);
    const db = await openOpencodeDb(dbPath);
    if (!db) {
      return null;
    }
    try {
      return this.loadFromDb(db, dbPath, sessionId);
    } catch {
      return null;
    } finally {
      db.close();
    }
  }
}
