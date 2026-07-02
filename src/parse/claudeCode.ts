import type { AgentSource, Session, SessionAdapter, SessionSummary, ToolCall, Turn } from "./types.js";
import { isChildPath, parseChildPath } from "./children.js";
import {
  addUsage,
  emptyUsage,
  expandHome,
  listFiles,
  mapWithConcurrency,
  parseTimestamp,
  pathExists,
  readJsonl,
  truncate,
  withTotal,
} from "./util.js";
import * as fs from "node:fs";

/** Raw shapes from a Claude Code `.jsonl` transcript line. Only the fields we use. */
interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  /** Newer Claude Code sessions split the flat `cache_creation_input_tokens` total by ephemeral TTL tier. Older sessions omit this object entirely. */
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
}

interface RawContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface RawMessage {
  role?: string;
  model?: string;
  content?: unknown;
  usage?: RawUsage;
}

interface RawRecord {
  type?: string;
  uuid?: string;
  timestamp?: string | number;
  sessionId?: string;
  aiTitle?: string;
  isMeta?: boolean;
  message?: RawMessage;
  /** SPEC-0019 R1a — attribution-only working directory / branch, present on
   * every user/assistant record; captured first-seen. */
  cwd?: string;
  gitBranch?: string;
  /** SPEC-0019 R1c — the raw child marker. */
  isSidechain?: boolean;
}

// command-echo wrapper tags injected into the transcript by the CLI itself — not
// real user/assistant content.
const COMMAND_ECHO_RE = /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-caveat)>/;

function stringifyToolResult(content: unknown): string {
  if (content == null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return typeof part === "string" ? part : JSON.stringify(part);
      })
      .join("");
  }
  return JSON.stringify(content);
}

/**
 * Map Claude Code's raw usage onto our `TokenUsage`.
 * `cache_creation_input_tokens` is carried as its own `cacheCreation` field
 * rather than folded into `input` — `src/pricing/resolve.ts`'s `costOf`
 * prices it against the vendor's cited cache-write rate (I2: pricing
 * cache-writes at the base input rate would understate cost on
 * cache-write-heavy sessions, our flagship case).
 *
 * When the transcript's nested `cache_creation` object is present, its
 * `ephemeral_5m_input_tokens`/`ephemeral_1h_input_tokens` become
 * `cacheCreation5m`/`cacheCreation1h` so `costOf` can price each tier at its
 * own cited rate rather than assuming one. The flat `cache_creation_input_tokens`
 * field is always present when there's any cache-write activity and is used
 * as the `cacheCreation` total when set; the split-tier sum is only used as
 * a fallback for sessions where the flat field itself is missing.
 */
function mapUsage(usage: RawUsage | undefined) {
  if (!usage) {
    return undefined;
  }
  const split = usage.cache_creation;
  const has5m = split?.ephemeral_5m_input_tokens !== undefined;
  const has1h = split?.ephemeral_1h_input_tokens !== undefined;
  const splitSum = (split?.ephemeral_5m_input_tokens ?? 0) + (split?.ephemeral_1h_input_tokens ?? 0);
  return withTotal({
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheCreation: usage.cache_creation_input_tokens ?? (has5m || has1h ? splitSum : 0),
    cacheCreation5m: has5m ? split.ephemeral_5m_input_tokens : undefined,
    cacheCreation1h: has1h ? split.ephemeral_1h_input_tokens : undefined,
    total: 0,
  });
}

async function parseTranscript(filePath: string, withTurns: boolean) {
  let model: string | undefined;
  let aiTitle: string | undefined;
  let firstUserText: string | undefined;
  let startedAt: number | undefined;
  let endedAt: number | undefined;
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let rawSidechain = false;
  let totalUsage = emptyUsage();
  let turnCount = 0;
  let toolCallCount = 0;
  const turns: Turn[] = [];
  const toolCallById = new Map<string, ToolCall>();

  await readJsonl(filePath, (raw) => {
    const r = raw as RawRecord;

    // R1a: first-seen cwd/gitBranch (attribution-only). Absent in raw → absent in model.
    if (cwd === undefined && typeof r.cwd === "string" && r.cwd) {
      cwd = r.cwd;
    }
    if (gitBranch === undefined && typeof r.gitBranch === "string" && r.gitBranch) {
      gitBranch = r.gitBranch;
    }
    if (r.isSidechain === true) {
      rawSidechain = true;
    }

    if (r.type === "ai-title" && typeof r.aiTitle === "string") {
      aiTitle = r.aiTitle;
    }
    if (r.isMeta) {
      return;
    }

    const ts = parseTimestamp(r.timestamp);
    if (ts !== undefined) {
      startedAt = startedAt === undefined ? ts : Math.min(startedAt, ts);
      endedAt = endedAt === undefined ? ts : Math.max(endedAt, ts);
    }

    if (r.type === "assistant" && r.message) {
      const msg = r.message;
      model ??= msg.model;
      const usage = mapUsage(msg.usage);
      if (usage) {
        totalUsage = addUsage(totalUsage, usage);
      }
      turnCount++;

      const toolCalls: ToolCall[] = [];

      if (typeof msg.content === "string") {
        if (COMMAND_ECHO_RE.test(msg.content)) {
          return;
        }
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content as RawContentBlock[]) {
          if (block.type === "tool_use") {
            toolCallCount++;
            const call: ToolCall = {
              name: block.name ?? "tool",
              input: block.input,
              status: "running",
              startedAt: ts,
            };
            toolCalls.push(call);
            if (block.id) {
              toolCallById.set(block.id, call);
            }
          }
        }
      }

      turns.push({
        index: turns.length,
        timestamp: ts,
        model: msg.model,
        usage,
        outputTokens: usage?.output,
        toolCalls,
      });
      return;
    }

    if (r.type === "user" && r.message) {
      const msg = r.message;
      if (typeof msg.content === "string") {
        if (COMMAND_ECHO_RE.test(msg.content)) {
          return;
        }
        firstUserText ??= msg.content;
        return;
      }
      if (Array.isArray(msg.content)) {
        for (const block of msg.content as RawContentBlock[]) {
          if (block.type === "text" && typeof block.text === "string") {
            firstUserText ??= block.text;
          } else if (block.type === "tool_result") {
            const id = block.tool_use_id;
            const output = stringifyToolResult(block.content);
            const status = block.is_error ? "error" : "ok";
            if (id) {
              const existing = toolCallById.get(id);
              if (existing) {
                existing.output = output;
                existing.status = status;
                existing.endedAt = ts;
              }
            }
          }
        }
      }
    }
  });

  const totals = {
    tokens: totalUsage,
    durationMs: startedAt !== undefined && endedAt !== undefined ? endedAt - startedAt : undefined,
    turnCount,
    toolCallCount,
  };

  // R1c: a subagent transcript is a child either by disk layout or by the raw
  // `isSidechain` marker; child linkage comes from the path (the disk layout is
  // the discovery contract).
  const childRef = parseChildPath(filePath);
  const summary: SessionSummary = {
    id: filePath,
    source: "claude-code",
    title: aiTitle || (firstUserText ? truncate(firstUserText) : undefined),
    model,
    startedAt,
    endedAt,
    totals,
    filePath,
    cwd,
    gitBranch,
    isSidechain: rawSidechain || childRef !== null ? true : undefined,
    parentSessionId: childRef?.parentSessionId,
    agentId: childRef?.agentId,
    parentFilePath: childRef?.parentFilePath,
  };

  return withTurns ? { summary, turns } : { summary, turns: [] as Turn[] };
}

const ROOT = "~/.claude/projects";

export class ClaudeCodeAdapter implements SessionAdapter {
  readonly id: AgentSource = "claude-code";
  readonly label = "Claude Code";

  roots(): string[] {
    return [expandHome(ROOT)];
  }

  async detect(): Promise<boolean> {
    return pathExists(expandHome(ROOT));
  }

  async listSessions(): Promise<SessionSummary[]> {
    const all = await listFiles(expandHome(ROOT), (name) => name.endsWith(".jsonl"));
    // R1c: subagent transcripts are excluded from top-level selection — they roll
    // up into their parent's receipt, never appear as standalone sessions.
    const files = all.filter((file) => !isChildPath(file));
    const results = await mapWithConcurrency(files, 16, async (file) => {
      try {
        const stat = await fs.promises.stat(file);
        if (stat.size === 0) {
          return null;
        }
        const { summary } = await parseTranscript(file, false);
        return summary;
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
      const { summary, turns } = await parseTranscript(id, true);
      return { ...summary, turns };
    } catch {
      return null;
    }
  }
}
