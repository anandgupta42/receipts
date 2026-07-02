import { sep } from "node:path";
import type { AgentSource, ListSessionsOptions, Session, SessionAdapter, SessionSummary, TokenUsage, ToolCall, Turn } from "./types.js";
import { lazyGeminiSummary, nodeDiscoveryFs, type DiscoveryFs } from "./discovery.js";
import { addUsage, emptyUsage, expandHome, listFiles, mapWithConcurrency, parseTimestamp, pathExists, readJsonl, truncate, withTotal } from "./util.js";

/**
 * Gemini CLI (`ChatRecordingService`) writes an append-only JSONL transcript
 * per session under `~/.gemini/tmp/<projectHash>/chats/` (subagents nest under
 * `chats/<parentSessionId>/`). Evidence + schema: `docs/spikes/spec-0010-gemini.md`.
 *
 * Line variants (one JSON record per line):
 *   1. session metadata (first line): { sessionId, projectHash, startTime,
 *      lastUpdated, kind, directories, summary? } — no `type` field.
 *   2. message: { id, timestamp, type: "user"|"gemini", content, ... }. A
 *      "gemini" message additionally carries `model`, `tokens`, `toolCalls`.
 *   3. `{ "$set": { … } }` metadata update (a `$set.messages` array is a
 *      checkpoint that clears + rebuilds the message list).
 *   4. `{ "$rewindTo": "<messageId>" }` — drops that message and everything
 *      appended after it.
 *
 * Messages dedupe by `id` (a re-appended message with the same id replaces the
 * earlier copy — how tool results merge into their requesting turn), so the
 * parser keeps a last-wins insertion-ordered map rather than summing lines,
 * which would double-count usage (I2).
 *
 * FULL-FIDELITY (R3): per-turn model id + a complete `TokensSummary` are on
 * disk, so Gemini prices like Claude Code / Codex — not degraded like Cursor.
 */

/** Raw per-turn usage on a `"gemini"` message — `TokensSummary` in gemini-cli. */
interface GeminiTokens {
  input?: number;
  output?: number;
  cached?: number;
  thoughts?: number;
  tool?: number;
  total?: number;
}

interface GeminiToolCall {
  id?: string;
  name?: string;
  displayName?: string;
  status?: string;
}

interface GeminiMessage {
  id?: string;
  timestamp?: unknown;
  type?: string;
  content?: unknown;
  model?: string;
  tokens?: GeminiTokens;
  toolCalls?: GeminiToolCall[];
}

/**
 * Map Gemini's `TokensSummary` onto our 4-component `TokenUsage`.
 *
 * Gemini's `total` = prompt + candidates + thoughts + tool-use, with `cached`
 * a subset of `input` (prompt). So, mirroring `codex.ts`'s no-under-report rule:
 *   - `cacheRead` = `cached` (priced at the cited `input_cached` rate).
 *   - `input` = (`input` − `cached`) + `tool`: the non-cached prompt plus the
 *     tool-use prompt tokens, both billed at the input rate (the flat price
 *     schema has no separate tool rate, so folding prices them honestly rather
 *     than dropping billed spend).
 *   - `output` = `output` + `thoughts`: Gemini 2.5 reports thinking separately
 *     from candidates and bills it at the output rate (google row: "Output price
 *     (including thinking tokens)") — folding matches the cited rate without
 *     double-counting candidates.
 *   - `cacheCreation` = 0 (and `cacheCreation5m`/`1h` stay undefined): Gemini's
 *     usage metadata has no cache-write counterpart — implicit caching is
 *     automatic and priced only as a cached-read discount, so `google.json`
 *     carries no `input_cache_write_*` rows.
 * `withTotal` recomputes `total` = input+output+cacheRead = Gemini's original
 * `totalTokenCount`, keeping the receipt's token line self-consistent.
 */
function mapUsage(tokens: GeminiTokens | undefined): TokenUsage | undefined {
  if (!tokens) {
    return undefined;
  }
  const cached = tokens.cached ?? 0;
  const input = Math.max(0, (tokens.input ?? 0) - cached) + (tokens.tool ?? 0);
  const output = (tokens.output ?? 0) + (tokens.thoughts ?? 0);
  return withTotal({ input, output, cacheRead: cached, cacheCreation: 0, total: 0 });
}

function extractText(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return typeof part === "string" ? part : undefined;
      })
      .filter((p): p is string => typeof p === "string");
    return parts.length > 0 ? parts.join("") : undefined;
  }
  return undefined;
}

function toToolCall(raw: GeminiToolCall): ToolCall {
  return {
    name: typeof raw.name === "string" && raw.name ? raw.name : "tool",
    // No per-tool-call timestamp is recorded (only the message's) — startedAt/
    // endedAt stay undefined rather than fabricating precision (I3, R4a).
    status: raw.status === "error" ? "error" : "ok",
  };
}

/** A parsed message plus enough metadata to materialize a Turn later. */
interface ParsedRecords {
  sessionId?: string;
  model?: string;
  startedAt?: number;
  endedAt?: number;
  cwd?: string;
  isSidechain?: boolean;
  firstUserText?: string;
  /** insertion-ordered, last-wins by message id (R1: dedupe + rewind) */
  messages: Map<string, GeminiMessage>;
}

async function readRecords(filePath: string): Promise<ParsedRecords> {
  const out: ParsedRecords = { messages: new Map() };

  await readJsonl(filePath, (record) => {
    if (!record || typeof record !== "object") {
      return;
    }
    const top = record as Record<string, unknown>;

    // Rewind: drop the named message and everything appended after it.
    if (typeof top.$rewindTo === "string") {
      const target = top.$rewindTo;
      let seen = false;
      for (const key of [...out.messages.keys()]) {
        if (key === target) {
          seen = true;
        }
        if (seen) {
          out.messages.delete(key);
        }
      }
      return;
    }

    // `$set.messages` is a checkpoint that clears + rebuilds the message list.
    if (top.$set && typeof top.$set === "object") {
      const set = top.$set as Record<string, unknown>;
      if (Array.isArray(set.messages)) {
        out.messages.clear();
        for (const m of set.messages) {
          if (m && typeof m === "object" && typeof (m as GeminiMessage).id === "string") {
            out.messages.set((m as GeminiMessage).id as string, m as GeminiMessage);
          }
        }
      }
      return;
    }

    const type = top.type;
    if (type === "user" || type === "gemini") {
      const msg = top as GeminiMessage;
      const ts = parseTimestamp(msg.timestamp);
      if (ts !== undefined) {
        out.startedAt = out.startedAt === undefined ? ts : Math.min(out.startedAt, ts);
        out.endedAt = out.endedAt === undefined ? ts : Math.max(out.endedAt, ts);
      }
      if (type === "user" && out.firstUserText === undefined) {
        out.firstUserText = extractText(msg.content);
      }
      if (type === "gemini" && typeof msg.model === "string") {
        out.model ??= msg.model;
      }
      if (typeof msg.id === "string") {
        out.messages.set(msg.id, msg);
      }
      return;
    }

    // Otherwise: the session-metadata record (no `type`).
    if (typeof top.sessionId === "string") {
      out.sessionId ??= top.sessionId;
    }
    const start = parseTimestamp(top.startTime);
    if (start !== undefined) {
      out.startedAt = out.startedAt === undefined ? start : Math.min(out.startedAt, start);
    }
    if (out.cwd === undefined && Array.isArray(top.directories) && typeof top.directories[0] === "string" && top.directories[0]) {
      out.cwd = top.directories[0];
    }
    if (top.kind === "subagent") {
      out.isSidechain = true;
    }
  });

  return out;
}

/** Materialize the deduped/rewound records into a normalized session. */
function buildSession(filePath: string, records: ParsedRecords): { summary: SessionSummary; turns: Turn[] } {
  const turns: Turn[] = [];
  let totalUsage = emptyUsage();
  let toolCallCount = 0;

  for (const msg of records.messages.values()) {
    if (msg.type !== "gemini") {
      continue;
    }
    const usage = mapUsage(msg.tokens);
    const toolCalls = Array.isArray(msg.toolCalls) ? msg.toolCalls.map(toToolCall) : [];
    toolCallCount += toolCalls.length;
    if (usage) {
      totalUsage = addUsage(totalUsage, usage);
    }
    turns.push({
      index: turns.length,
      timestamp: parseTimestamp(msg.timestamp),
      model: msg.model ?? records.model,
      usage,
      outputTokens: usage?.output,
      toolCalls,
    });
  }

  const summary: SessionSummary = {
    id: filePath,
    source: "gemini",
    title: records.firstUserText ? truncate(records.firstUserText) : undefined,
    model: records.model,
    startedAt: records.startedAt,
    endedAt: records.endedAt,
    totals: {
      tokens: totalUsage,
      durationMs:
        records.startedAt !== undefined && records.endedAt !== undefined ? Math.max(0, records.endedAt - records.startedAt) : undefined,
      turnCount: turns.length,
      toolCallCount,
    },
    filePath,
    cwd: records.cwd,
    isSidechain: records.isSidechain,
  };

  return { summary, turns };
}

const ROOT = "~/.gemini/tmp";

export class GeminiAdapter implements SessionAdapter {
  readonly id: AgentSource = "gemini";
  readonly label = "Gemini CLI";

  private readonly root: string;
  private readonly discoveryFs: DiscoveryFs;

  constructor(opts: { root?: string; fs?: DiscoveryFs } = {}) {
    this.root = opts.root ?? expandHome(ROOT);
    this.discoveryFs = opts.fs ?? nodeDiscoveryFs;
  }

  roots(): string[] {
    return [this.root];
  }

  async detect(): Promise<boolean> {
    return pathExists(this.root);
  }

  async listSessions(options: ListSessionsOptions = {}): Promise<SessionSummary[]> {
    // Recorded chats live under a `chats/` directory (main + subagent both);
    // other tmp subtrees (logs/, checkpoints/) are not session transcripts.
    const files = (await listFiles(this.root, (name) => name.endsWith(".jsonl"))).filter((p) => p.includes(`${sep}chats${sep}`));
    const results = await mapWithConcurrency(files, 16, async (file) => {
      try {
        const stat = await this.discoveryFs.stat(file);
        if (stat.size === 0) {
          return null;
        }
        if (!options.full) {
          const firstLine = await this.discoveryFs.readFirstLine(file);
          return lazyGeminiSummary({ filePath: file, source: this.id, stat, firstLine });
        }
        return buildSession(file, await readRecords(file)).summary;
      } catch {
        return null;
      }
    });
    return results.filter((s): s is SessionSummary => s !== null);
  }

  async loadSession(id: string): Promise<Session | null> {
    try {
      if (!(await pathExists(id))) {
        return null;
      }
      const { summary, turns } = buildSession(id, await readRecords(id));
      return { ...summary, turns };
    } catch {
      return null;
    }
  }
}
