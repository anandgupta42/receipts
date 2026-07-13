import { homedir } from "node:os";
import { delimiter as pathDelimiter, isAbsolute, join, resolve } from "node:path";
import { promises as fs } from "node:fs";
import { openReadOnly, type SqliteReader } from "./sqlite.js";
import { normalizePricingProvider } from "./provider.js";
import { toSessionSummary } from "./summaryCache.js";
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
import { addUsage, emptyUsage, parseTimestamp, pathExists, safeTokenSum, truncate, withTotal, sanitizeText } from "./util.js";

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
  input?: unknown;
  output?: unknown;
  reasoning?: unknown;
  cache?: unknown;
}

interface RawMessageData {
  role?: string;
  text?: string;
  model?: string | { id?: unknown; providerID?: unknown; variant?: unknown };
  modelID?: string;
  providerID?: unknown;
  tokens?: unknown;
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
  time_created?: unknown;
  time_updated?: unknown;
  tokens_input?: unknown;
  tokens_output?: unknown;
  tokens_reasoning?: unknown;
  tokens_cache_read?: unknown;
  tokens_cache_write?: unknown;
  turn_count?: number;
  tool_count?: number;
  message_input?: unknown;
  message_output?: unknown;
  message_reasoning?: unknown;
  message_cache_read?: unknown;
  message_cache_write?: unknown;
  first_model?: string;
}

interface MessageRow {
  id: string;
  time_created?: unknown;
  time_updated?: unknown;
  data?: string;
}

interface MessageTimeRow {
  time_created?: unknown;
  time_updated?: unknown;
  data_created?: unknown;
  data_completed?: unknown;
}

interface PartRow {
  message_id: string;
  data?: string;
}

interface OpenCodeSchema {
  sessionColumns: ReadonlySet<string>;
  current: boolean;
  legacy: boolean;
}

interface OpenCodeDatabase {
  db: SqliteReader;
  schema: OpenCodeSchema;
}

function defaultRoot(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData/Local");
    return join(localAppData, "opencode");
  }
  return join(homedir(), ".local/share/opencode");
}

export function parseOpenCodeDataDirs(value: string | undefined, delimiter = pathDelimiter): string[] {
  if (!value?.trim()) {
    return [];
  }
  return value
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeRoots(roots: readonly string[]): string[] {
  return [...new Set(roots.map((root) => resolve(root)))].sort();
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** node:sqlite throws when reading an INTEGER outside JS's safe range. Return
 * only those values as text so the parser can reject them explicitly. */
function safeSqlInteger(expression: string): string {
  return `CASE WHEN typeof(${expression}) = 'integer' AND (${expression} > 9007199254740991 OR ${expression} < -9007199254740991) THEN CAST(${expression} AS TEXT) ELSE ${expression} END`;
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

interface ParsedTokenValue {
  value: number;
  valid: boolean;
}

interface MappedOpenCodeUsage {
  usage?: TokenUsage;
  malformed: boolean;
}

function parseTokenValue(value: unknown, allowNumericString: boolean): ParsedTokenValue {
  if (value === undefined) {
    return { value: 0, valid: true };
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return { value, valid: true };
  }
  if (allowNumericString && typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 0) {
      return { value: parsed, valid: true };
    }
  }
  return { value: 0, valid: false };
}

/** Preserve valid buckets from malformed message usage, but never price it. */
function mapTokens(raw: unknown, present: boolean): MappedOpenCodeUsage {
  if (!present) {
    return { malformed: false };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { usage: emptyUsage(), malformed: true };
  }
  const tokens = raw as RawTokens & Record<string, unknown>;
  const input = parseTokenValue(tokens.input, false);
  const output = parseTokenValue(tokens.output, false);
  const reasoning = parseTokenValue(tokens.reasoning, false);

  let cacheMalformed = false;
  let cacheRead: ParsedTokenValue = { value: 0, valid: true };
  let cacheWrite: ParsedTokenValue = { value: 0, valid: true };
  if (Object.prototype.hasOwnProperty.call(tokens, "cache")) {
    const cache = tokens.cache;
    if (!cache || typeof cache !== "object" || Array.isArray(cache)) {
      cacheMalformed = true;
    } else {
      const cacheRecord = cache as Record<string, unknown>;
      cacheRead = parseTokenValue(cacheRecord.read, false);
      cacheWrite = parseTokenValue(cacheRecord.write, false);
    }
  }

  const mappedOutput = safeTokenSum([output.value, reasoning.value]);
  const mappedTotal = mappedOutput === undefined
    ? undefined
    : safeTokenSum([input.value, mappedOutput, cacheRead.value, cacheWrite.value]);
  if (mappedOutput === undefined || mappedTotal === undefined) {
    return { usage: emptyUsage(), malformed: true };
  }

  return {
    malformed:
      !input.valid ||
      !output.valid ||
      !reasoning.valid ||
      cacheMalformed ||
      !cacheRead.valid ||
      !cacheWrite.valid,
    usage: withTotal({
      input: input.value,
      output: mappedOutput,
      cacheRead: cacheRead.value,
      cacheCreation: cacheWrite.value,
      total: 0,
    }),
  };
}

interface UsageProjection {
  usage: TokenUsage;
  valid: boolean;
}

function usageProjection(values: readonly unknown[]): UsageProjection {
  const [rawInput, rawOutput, rawReasoning, rawCacheRead, rawCacheWrite] = values;
  const input = parseTokenValue(rawInput, true);
  const output = parseTokenValue(rawOutput, true);
  const reasoning = parseTokenValue(rawReasoning, true);
  const cacheRead = parseTokenValue(rawCacheRead, true);
  const cacheWrite = parseTokenValue(rawCacheWrite, true);
  const outputTotal = safeTokenSum([output.value, reasoning.value]);
  const componentTotal = outputTotal === undefined
    ? undefined
    : safeTokenSum([input.value, outputTotal, cacheRead.value, cacheWrite.value]);
  if (outputTotal === undefined || componentTotal === undefined) {
    return { valid: false, usage: emptyUsage() };
  }
  return {
    valid: input.valid && output.valid && reasoning.valid && cacheRead.valid && cacheWrite.valid,
    usage: withTotal({
      input: input.value,
      output: outputTotal,
      cacheRead: cacheRead.value,
      cacheCreation: cacheWrite.value,
      total: 0,
    }),
  };
}

interface AggregateUsageEvidence {
  usage: TokenUsage;
  sessionMalformed: boolean;
}

function usageFromSessionColumns(row: SessionRow, trustMessageProjection = true): AggregateUsageEvidence {
  const sessionProjection = usageProjection([
    row.tokens_input,
    row.tokens_output,
    row.tokens_reasoning,
    row.tokens_cache_read,
    row.tokens_cache_write,
  ]);
  const messageProjection = usageProjection([
    row.message_input,
    row.message_output,
    row.message_reasoning,
    row.message_cache_read,
    row.message_cache_write,
  ]);
  const candidates = [
    ...(sessionProjection.valid ? [sessionProjection.usage] : []),
    ...(trustMessageProjection && messageProjection.valid ? [messageProjection.usage] : []),
  ];
  const usage = candidates.reduce<TokenUsage>(
    (largest, candidate) => candidate.total > largest.total ? candidate : largest,
    emptyUsage(),
  );
  // Keep each projection coherent and retain the larger observed envelope;
  // independently maximizing its buckets could create a vector no row ever
  // reported. A malformed projection is excluded wholesale; its valid-looking
  // components cannot dominate or manufacture a residual. Per-component
  // reconciliation with itemized turns happens below.
  return { usage, sessionMalformed: !sessionProjection.valid };
}

/** Usage present in the reconciled session envelope but absent from itemized messages. */
function aggregateResidual(envelope: TokenUsage, itemized: TokenUsage): TokenUsage {
  return withTotal({
    input: Math.max(0, envelope.input - itemized.input),
    output: Math.max(0, envelope.output - itemized.output),
    cacheRead: Math.max(0, envelope.cacheRead - itemized.cacheRead),
    cacheCreation: Math.max(0, envelope.cacheCreation - itemized.cacheCreation),
    total: 0,
  });
}

function componentwiseDominates(envelope: TokenUsage, itemized: TokenUsage): boolean {
  return (
    envelope.input >= itemized.input &&
    envelope.output >= itemized.output &&
    envelope.cacheRead >= itemized.cacheRead &&
    envelope.cacheCreation >= itemized.cacheCreation
  );
}

/** Preserve aggregate-only usage without fabricating a request, model, or tool. */
function reconcileAggregateResidual(
  itemized: TokenUsage,
  envelope: TokenUsage,
): { total: TokenUsage; unattributed?: TokenUsage; conflicting?: TokenUsage } {
  const residual = aggregateResidual(envelope, itemized);
  if (residual.total === 0) {
    return { total: itemized };
  }
  // A residual is additive only when the aggregate dominates the itemized
  // vector in every component. Crossed vectors can be alternate or stale
  // projections; taking their component-wise maximum would fabricate a usage
  // vector that neither source reported.
  if (!componentwiseDominates(envelope, itemized)) {
    return { total: itemized, conflicting: residual };
  }
  return { total: envelope, unattributed: residual };
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

function pricingProviderFromModel(value: unknown): Turn["pricingProvider"] {
  const parsed = typeof value === "string"
    ? parseJsonObject<{ providerID?: unknown }>(value)
    : value && typeof value === "object"
      ? (value as { providerID?: unknown })
      : null;
  if (!parsed || !Object.prototype.hasOwnProperty.call(parsed, "providerID")) {
    return undefined;
  }
  return normalizePricingProvider(parsed.providerID);
}

function pricingProviderForMessage(msg: RawMessageData): Turn["pricingProvider"] {
  if (Object.prototype.hasOwnProperty.call(msg, "providerID")) {
    return normalizePricingProvider(msg.providerID) ?? null;
  }
  const fromModel = pricingProviderFromModel(msg.model);
  if (fromModel !== undefined) {
    return fromModel;
  }
  const fromModelId = pricingProviderFromModel(msg.modelID);
  // Current OpenCode assistant messages require their own model/provider
  // identity. Missing request identity is not repaired from session metadata:
  // doing so can retroactively price an earlier routed/unknown request.
  return fromModelId !== undefined ? fromModelId : null;
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
      tokens: usageFromSessionColumns(row).usage,
      durationMs: startedAt !== undefined && endedAt !== undefined ? Math.max(0, endedAt - startedAt) : undefined,
      turnCount: numberOrZero(row.turn_count),
      toolCallCount: numberOrZero(row.tool_count),
    },
    filePath: dbPath,
    cwd: typeof row.directory === "string" && row.directory ? row.directory : undefined,
  };
}

function toToolCall(part: RawPartData): ToolCall | null {
  const rawName = typeof part.tool === "string" && part.tool ? part.tool : part.name;
  const name = typeof rawName === "string" ? sanitizeText(rawName) : rawName;
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

function tableColumns(db: SqliteReader, name: string): ReadonlySet<string> | null {
  try {
    const rows = db.all(`PRAGMA table_info(${sqlString(name)})`) as unknown as Array<{ name?: unknown }>;
    if (rows.length === 0) {
      return null;
    }
    return new Set(rows.map((row) => row.name).filter((column): column is string => typeof column === "string"));
  } catch {
    return null;
  }
}

function includesColumns(actual: ReadonlySet<string> | null, required: readonly string[]): actual is ReadonlySet<string> {
  return actual !== null && required.every((column) => actual.has(column));
}

function qualifyOpenCodeSchema(db: SqliteReader): OpenCodeSchema | null {
  const sessionColumns = tableColumns(db, "session");
  if (!includesColumns(sessionColumns, ["id", "time_created", "time_updated"])) {
    return null;
  }

  const current = includesColumns(tableColumns(db, "session_message"), [
    "id",
    "session_id",
    "type",
    "seq",
    "time_created",
    "time_updated",
    "data",
  ]);
  const legacy =
    includesColumns(tableColumns(db, "message"), ["id", "session_id", "time_created", "time_updated", "data"]) &&
    includesColumns(tableColumns(db, "part"), ["id", "message_id", "session_id", "time_created", "data"]);
  return current || legacy ? { sessionColumns, current, legacy } : null;
}

function hasCurrentRows(db: SqliteReader, sessionId: string, schema: OpenCodeSchema): boolean {
  if (!schema.current) {
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

function messageTimeBounds(
  db: SqliteReader,
  sessionId: string,
  branch: "current" | "legacy",
): { startedAt?: number; endedAt?: number } {
  const table = branch === "current" ? "session_message" : "message";
  const assistant = branch === "current" ? "m.type = 'assistant'" : "json_extract(m.data, '$.role') = 'assistant'";
  const order = branch === "current" ? "m.seq" : "m.time_created, m.id";
  const rows = db.all(`
    SELECT
      m.time_created,
      m.time_updated,
      json_extract(m.data, '$.time.created') AS data_created,
      json_extract(m.data, '$.time.completed') AS data_completed
    FROM ${table} m
    WHERE m.session_id = ${sqlString(sessionId)} AND ${assistant}
    ORDER BY ${order}
  `) as unknown as MessageTimeRow[];
  let startedAt: number | undefined;
  let endedAt: number | undefined;
  for (const row of rows) {
    const started = timestampOf(row.data_created, row.time_created);
    const ended = timestampOf(row.data_completed, row.time_updated, started);
    if (started !== undefined) {
      startedAt = startedAt === undefined ? started : Math.min(startedAt, started);
    }
    if (ended !== undefined) {
      endedAt = endedAt === undefined ? ended : Math.max(endedAt, ended);
    }
  }
  return { startedAt, endedAt };
}

function summaryRowFor(db: SqliteReader, sessionId: string, schema: OpenCodeSchema): SessionRow | undefined {
  const where = `WHERE s.id = ${sqlString(sessionId)}`;
  const branch = hasCurrentRows(db, sessionId, schema) || !schema.legacy ? "current" : "legacy";
  const sql = branch === "current" ? currentSummarySql(schema.sessionColumns, where) : summarySql(schema.sessionColumns, where);
  const row = db.all(`${sql} LIMIT 1`)[0] as unknown as SessionRow | undefined;
  if (!row) {
    return undefined;
  }
  const bounds = messageTimeBounds(db, sessionId, branch);
  return {
    ...row,
    time_created: bounds.startedAt ?? row.time_created,
    time_updated: bounds.endedAt ?? row.time_updated,
  };
}

async function openOpencodeDb(dbPath: string): Promise<OpenCodeDatabase | null> {
  if (!(await pathExists(dbPath))) {
    return null;
  }
  const db = await openReadOnly(dbPath);
  if (!db) {
    return null;
  }
  const schema = qualifyOpenCodeSchema(db);
  if (!schema) {
    db.close();
    return null;
  }
  return { db, schema };
}

function optionalSessionColumn(columns: ReadonlySet<string>, name: string, fallback: "NULL" | "0"): string {
  return columns.has(name) ? `s.${name} AS ${name}` : `${fallback} AS ${name}`;
}

function optionalSessionInteger(columns: ReadonlySet<string>, name: string): string {
  return columns.has(name) ? `${safeSqlInteger(`s.${name}`)} AS ${name}` : `0 AS ${name}`;
}

function currentSummarySql(sessionColumns: ReadonlySet<string>, where = ""): string {
  return `
    SELECT
      s.id,
      ${optionalSessionColumn(sessionColumns, "title", "NULL")},
      ${optionalSessionColumn(sessionColumns, "model", "NULL")},
      ${optionalSessionColumn(sessionColumns, "version", "NULL")},
      ${optionalSessionColumn(sessionColumns, "directory", "NULL")},
      ${optionalSessionColumn(sessionColumns, "path", "NULL")},
      s.time_created,
      s.time_updated,
      ${optionalSessionInteger(sessionColumns, "tokens_input")},
      ${optionalSessionInteger(sessionColumns, "tokens_output")},
      ${optionalSessionInteger(sessionColumns, "tokens_reasoning")},
      ${optionalSessionInteger(sessionColumns, "tokens_cache_read")},
      ${optionalSessionInteger(sessionColumns, "tokens_cache_write")},
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
        SELECT ${safeSqlInteger("SUM(COALESCE(json_extract(m.data, '$.tokens.input'), 0))")}
        FROM session_message m
        WHERE m.session_id = s.id AND m.type = 'assistant'
      ) AS message_input,
      (
        SELECT ${safeSqlInteger("SUM(COALESCE(json_extract(m.data, '$.tokens.output'), 0))")}
        FROM session_message m
        WHERE m.session_id = s.id AND m.type = 'assistant'
      ) AS message_output,
      (
        SELECT ${safeSqlInteger("SUM(COALESCE(json_extract(m.data, '$.tokens.reasoning'), 0))")}
        FROM session_message m
        WHERE m.session_id = s.id AND m.type = 'assistant'
      ) AS message_reasoning,
      (
        SELECT ${safeSqlInteger("SUM(COALESCE(json_extract(m.data, '$.tokens.cache.read'), 0))")}
        FROM session_message m
        WHERE m.session_id = s.id AND m.type = 'assistant'
      ) AS message_cache_read,
      (
        SELECT ${safeSqlInteger("SUM(COALESCE(json_extract(m.data, '$.tokens.cache.write'), 0))")}
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

function summarySql(sessionColumns: ReadonlySet<string>, where = ""): string {
  return `
    SELECT
      s.id,
      ${optionalSessionColumn(sessionColumns, "title", "NULL")},
      ${optionalSessionColumn(sessionColumns, "model", "NULL")},
      ${optionalSessionColumn(sessionColumns, "version", "NULL")},
      ${optionalSessionColumn(sessionColumns, "directory", "NULL")},
      ${optionalSessionColumn(sessionColumns, "path", "NULL")},
      s.time_created,
      s.time_updated,
      ${optionalSessionInteger(sessionColumns, "tokens_input")},
      ${optionalSessionInteger(sessionColumns, "tokens_output")},
      ${optionalSessionInteger(sessionColumns, "tokens_reasoning")},
      ${optionalSessionInteger(sessionColumns, "tokens_cache_read")},
      ${optionalSessionInteger(sessionColumns, "tokens_cache_write")},
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
        SELECT ${safeSqlInteger("SUM(COALESCE(json_extract(m.data, '$.tokens.input'), 0))")}
        FROM message m
        WHERE m.session_id = s.id AND json_extract(m.data, '$.role') = 'assistant'
      ) AS message_input,
      (
        SELECT ${safeSqlInteger("SUM(COALESCE(json_extract(m.data, '$.tokens.output'), 0))")}
        FROM message m
        WHERE m.session_id = s.id AND json_extract(m.data, '$.role') = 'assistant'
      ) AS message_output,
      (
        SELECT ${safeSqlInteger("SUM(COALESCE(json_extract(m.data, '$.tokens.reasoning'), 0))")}
        FROM message m
        WHERE m.session_id = s.id AND json_extract(m.data, '$.role') = 'assistant'
      ) AS message_reasoning,
      (
        SELECT ${safeSqlInteger("SUM(COALESCE(json_extract(m.data, '$.tokens.cache.read'), 0))")}
        FROM message m
        WHERE m.session_id = s.id AND json_extract(m.data, '$.role') = 'assistant'
      ) AS message_cache_read,
      (
        SELECT ${safeSqlInteger("SUM(COALESCE(json_extract(m.data, '$.tokens.cache.write'), 0))")}
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
  private readonly dataRoots: string[];
  private readonly forcedDbPath?: string;

  constructor(opts: { root?: string; roots?: string[]; dbPath?: string } = {}) {
    const legacyRoot = opts.root ?? process.env.OPENCODE_DATA_DIR ?? defaultRoot();
    const explicitRoots = opts.roots?.filter((root) => root.trim().length > 0) ?? [];
    const environmentRoots = parseOpenCodeDataDirs(process.env.OPENCODE_DATA_DIRS);
    const selectedRoots =
      explicitRoots.length > 0
        ? explicitRoots
        : opts.root !== undefined
          ? [opts.root]
          : environmentRoots.length > 0
            ? environmentRoots
            : [process.env.OPENCODE_DATA_DIR ?? defaultRoot()];
    this.root = resolve(legacyRoot);
    this.dataRoots = normalizeRoots(selectedRoots);
    this.forcedDbPath = opts.dbPath ?? process.env.OPENCODE_DB_PATH ?? process.env.OPENCODE_DB;
  }

  roots(): string[] {
    return this.forcedDbPath ? [this.resolvedForcedDbPath()] : [...this.dataRoots];
  }

  private resolvedForcedDbPath(): string {
    if (this.forcedDbPath === ":memory:" || isAbsolute(this.forcedDbPath!)) {
      return this.forcedDbPath!;
    }
    return join(this.root, this.forcedDbPath!);
  }

  private async dbPaths(): Promise<string[]> {
    if (this.forcedDbPath) {
      return [this.resolvedForcedDbPath()];
    }
    const candidates = new Set<string>();
    for (const root of this.dataRoots) {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".db")) {
          candidates.add(join(root, entry.name));
        }
      }
    }
    return [...candidates].sort();
  }

  async detect(): Promise<boolean> {
    for (const file of await this.dbPaths()) {
      const opened = await openOpencodeDb(file);
      if (!opened) {
        continue;
      }
      const { db } = opened;
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
      const opened = await openOpencodeDb(dbPath);
      if (!opened) {
        continue;
      }
      const { db, schema } = opened;
      try {
        const rows = sessionIds(db)
          .map((sessionId) => summaryRowFor(db, sessionId, schema))
          .filter((row): row is SessionRow => row !== undefined);
        const summaries = rows.map((row) => summaryFromRow(dbPath, row));
        if (!options.full) {
          out.push(...summaries);
          continue;
        }
        for (const [index, row] of rows.entries()) {
          const session = this.loadFromDb(db, schema, dbPath, row.id);
          out.push(session ? toSessionSummary(session) : summaries[index]);
        }
      } catch {
        // A malformed DB degrades to "no sessions" for this adapter.
      } finally {
        db.close();
      }
    }
    return out;
  }

  private loadCurrent(
    db: SqliteReader,
    schema: OpenCodeSchema,
    dbPath: string,
    sessionId: string | undefined,
  ): Session | null {
    const where = sessionId ? `WHERE s.id = ${sqlString(sessionId)}` : "";
    const summaryRow = db.all(`${currentSummarySql(schema.sessionColumns, where)} LIMIT 1`)[0] as unknown as SessionRow | undefined;
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
    let droppedRecords = 0;
    let malformedMessageUsage = false;

    for (const row of messages) {
      const msg = parseJsonObject<RawMessageData>(row.data);
      if (!msg) {
        // SPEC-0044 B3 — a message row whose JSON is torn/corrupt (a partial DB
        // write), not a normal non-assistant row: its usage is lost, so count it.
        droppedRecords++;
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
      const mappedUsage = mapTokens(msg.tokens, Object.prototype.hasOwnProperty.call(msg, "tokens"));
      const usage = mappedUsage.usage;
      if (mappedUsage.malformed) {
        droppedRecords++;
        malformedMessageUsage = true;
      }
      if (usage) {
        totalUsage = addUsage(totalUsage, usage);
      }
      const pricingProvider = pricingProviderForMessage(msg);
      turns.push({
        index: turns.length,
        timestamp: ts,
        model: modelId(msg.modelID) ?? modelId(msg.model),
        ...(pricingProvider !== undefined ? { pricingProvider } : {}),
        usage,
        outputTokens: usage?.output,
        ...(mappedUsage.malformed ? { pricingUnits: [] } : {}),
        toolCalls: toolsFromContent(msg.content),
      });
    }

    const sessionStarted = startedAt ?? summary.startedAt;
    const sessionEnded = endedAt ?? summary.endedAt ?? sessionStarted;
    const toolCallCount = turns.reduce((sum, turn) => sum + turn.toolCalls.length, 0);
    const aggregateEvidence = usageFromSessionColumns(summaryRow, !malformedMessageUsage);
    if (aggregateEvidence.sessionMalformed) {
      droppedRecords++;
    }
    const reconciled = reconcileAggregateResidual(totalUsage, aggregateEvidence.usage);
    return {
      ...summary,
      title: summary.title ?? (firstUserText ? truncate(firstUserText) : undefined),
      startedAt: sessionStarted,
      endedAt: sessionEnded,
      totals: {
        tokens: reconciled.total,
        durationMs:
          sessionStarted !== undefined && sessionEnded !== undefined ? Math.max(0, sessionEnded - sessionStarted) : undefined,
        turnCount: summary.totals.turnCount,
        toolCallCount,
      },
      turns,
      ...(reconciled.unattributed ? { unattributedUsage: reconciled.unattributed } : {}),
      ...(reconciled.conflicting ? { conflictingAggregateUsage: reconciled.conflicting } : {}),
      // SPEC-0044 B3: present only when > 0 (absent → clean).
      ...(droppedRecords > 0 ? { droppedRecords } : {}),
    };
  }

  private loadLegacy(db: SqliteReader, schema: OpenCodeSchema, dbPath: string, sessionId: string): Session | null {
    const where = `WHERE s.id = ${sqlString(sessionId)}`;
    const summaryRow = db.all(`${summarySql(schema.sessionColumns, where)} LIMIT 1`)[0] as unknown as SessionRow | undefined;
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
    let droppedRecords = 0;
    let malformedMessageUsage = false;

    for (const row of messages) {
      const msg = parseJsonObject<RawMessageData>(row.data);
      if (!msg) {
        // SPEC-0044 B3 — torn/corrupt row (distinct from a valid non-assistant
        // row below): its usage is lost, so count it rather than skip silently.
        droppedRecords++;
        continue;
      }
      if (msg.role !== "assistant") {
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
      const mappedUsage = mapTokens(msg.tokens, Object.prototype.hasOwnProperty.call(msg, "tokens"));
      const usage = mappedUsage.usage;
      if (mappedUsage.malformed) {
        droppedRecords++;
        malformedMessageUsage = true;
      }
      if (usage) {
        totalUsage = addUsage(totalUsage, usage);
      }
      const pricingProvider = pricingProviderForMessage(msg);
      turns.push({
        index: turns.length,
        timestamp: ts,
        model: modelId(msg.modelID) ?? modelId(msg.model),
        ...(pricingProvider !== undefined ? { pricingProvider } : {}),
        usage,
        outputTokens: usage?.output,
        ...(mappedUsage.malformed ? { pricingUnits: [] } : {}),
        toolCalls: partsByMessage.get(row.id) ?? [],
      });
    }

    const sessionStarted = startedAt ?? summary.startedAt;
    const sessionEnded = endedAt ?? summary.endedAt ?? sessionStarted;
    const toolCallCount = turns.reduce((sum, turn) => sum + turn.toolCalls.length, 0);
    const aggregateEvidence = usageFromSessionColumns(summaryRow, !malformedMessageUsage);
    if (aggregateEvidence.sessionMalformed) {
      droppedRecords++;
    }
    const reconciled = reconcileAggregateResidual(totalUsage, aggregateEvidence.usage);
    return {
      ...summary,
      startedAt: sessionStarted,
      endedAt: sessionEnded,
      totals: {
        tokens: reconciled.total,
        durationMs:
          sessionStarted !== undefined && sessionEnded !== undefined ? Math.max(0, sessionEnded - sessionStarted) : undefined,
        turnCount: summary.totals.turnCount,
        toolCallCount,
      },
      turns,
      ...(reconciled.unattributed ? { unattributedUsage: reconciled.unattributed } : {}),
      ...(reconciled.conflicting ? { conflictingAggregateUsage: reconciled.conflicting } : {}),
      // SPEC-0044 B3: present only when > 0 (absent → clean).
      ...(droppedRecords > 0 ? { droppedRecords } : {}),
    };
  }

  private loadFromDb(
    db: SqliteReader,
    schema: OpenCodeSchema,
    dbPath: string,
    sessionId: string | undefined,
  ): Session | null {
    const selectedSessionId = sessionId ?? newestSessionId(db);
    if (!selectedSessionId) {
      return null;
    }
    if (hasCurrentRows(db, selectedSessionId, schema) || !schema.legacy) {
      return this.loadCurrent(db, schema, dbPath, selectedSessionId);
    }
    return this.loadLegacy(db, schema, dbPath, selectedSessionId);
  }

  async loadSession(id: string): Promise<Session | null> {
    const { dbPath, sessionId } = splitId(id);
    const opened = await openOpencodeDb(dbPath);
    if (!opened) {
      return null;
    }
    const { db, schema } = opened;
    try {
      return this.loadFromDb(db, schema, dbPath, sessionId);
    } catch {
      return null;
    } finally {
      db.close();
    }
  }
}
