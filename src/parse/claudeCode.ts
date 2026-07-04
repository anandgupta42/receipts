import type { AgentSource, Compaction, ListSessionsOptions, Session, SessionAdapter, SessionSummary, ToolCall, Turn } from "./types.js";
import { claudeCodeFidelity } from "./fidelity/claudeCode.js";
import { isUnderSubagents, parseChildPath } from "./children.js";
import { lazyClaudeCodeSummary, nodeDiscoveryFs, type DiscoveryFs } from "./discovery.js";
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
  /** SPEC-0017 R1 — newer Claude Code sessions flag a compact-summary record directly. */
  isCompactSummary?: boolean;
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

// SPEC-0017 R1 — the finite, named set of raw compaction shapes. Boundary/summary
// record `type`s (shape 2):
const COMPACT_BOUNDARY_TYPES = new Set(["compact-summary", "compact_boundary", "compact-boundary"]);
// The compact-summary wording carried by the `isMeta: true` user record (shape 3);
// anchored on "context compacted" so ordinary user text mentioning "compact" never
// matches (it isn't a meta record and doesn't carry this exact phrasing).
const COMPACT_SUMMARY_TEXT_RE = /\bcontext (?:was |has been )?compacted\b/i;
// The `/compact` command echo (shape 4): corroborating only — see `collectCompactions`.
const COMPACT_COMMAND_ECHO_RE = /<command-name>\s*compact\s*<\/command-name>/i;

/** Flatten a raw message `content` (string or content-block array) to its text, for compaction-shape matching only. */
function rawContentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string" ? (block as { text: string }).text : ""))
      .join("");
  }
  return "";
}

/**
 * SPEC-0017 R1 — classify a raw record as a compaction signal. `"summary"` is a
 * definitive compaction (shapes 1–3: `isCompactSummary`, a boundary `type`, or
 * the `isMeta` compact-summary text). `"echo"` is a bare `/compact` command echo
 * (shape 4): recognized here but never counted on its own, because a real
 * compaction always emits a summary/boundary record at the same position — so the
 * summary already records the event and a lone echo (no adjacent summary) is
 * correctly ignored (R1's "only when adjacent" reduces to counting summaries).
 */
function compactSignal(r: RawRecord): "summary" | "echo" | null {
  if (r.isCompactSummary === true) {
    return "summary";
  }
  if (typeof r.type === "string" && COMPACT_BOUNDARY_TYPES.has(r.type)) {
    return "summary";
  }
  const text = rawContentText(r.message?.content);
  if (r.isMeta === true && r.type === "user" && COMPACT_SUMMARY_TEXT_RE.test(text)) {
    return "summary";
  }
  if (COMPACT_COMMAND_ECHO_RE.test(text)) {
    return "echo";
  }
  return null;
}

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
  // SPEC-0017 R1/R2 — one entry per distinct next-assistant-turn index that a
  // compact summary/boundary record precedes. Keyed by `turnIndex` so an echo +
  // summary (or two summary shapes) at the same position collapse to one event.
  const compactionByTurn = new Map<number, number | undefined>();

  await readJsonl(filePath, (raw) => {
    const r = raw as RawRecord;

    // SPEC-0017 R1 — extract compactions BEFORE the isMeta/command-echo filters
    // below drop these records. `turns.length` is the index the next assistant
    // turn will receive (R2); an echo alone never records (its position has no
    // summary), and after-final compactions land at `turnIndex = turns.length`.
    if (compactSignal(r) === "summary" && !compactionByTurn.has(turns.length)) {
      compactionByTurn.set(turns.length, parseTimestamp(r.timestamp));
    }

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

    // SPEC-0038 R4 — the fork boundary cuts at the adapter: everything before a
    // `fork-context-ref` marker is inherited parent history and must not exist
    // downstream (anchors, slicing, pricing, rollup all see post-fork turns
    // only). Current fork files carry the marker first with no inherited copies;
    // the reset makes that a guarantee, not an observation.
    if (r.type === "fork-context-ref") {
      turns.length = 0;
      toolCallById.clear();
      compactionByTurn.clear();
      totalUsage = emptyUsage();
      turnCount = 0;
      toolCallCount = 0;
      model = undefined;
      firstUserText = undefined;
      aiTitle = undefined;
      rawSidechain = false;
      startedAt = undefined;
      endedAt = undefined;
      cwd = undefined;
      gitBranch = undefined;
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
              ...(block.name === "Bash" ? { shell: true } : {}),
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

  // SPEC-0017 R2 — one deduped compaction per next-assistant-turn index, ordered.
  const compactions: Compaction[] = [...compactionByTurn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turnIndex, atMs]) => (atMs === undefined ? { turnIndex } : { turnIndex, atMs }));

  return withTurns ? { summary, turns, compactions } : { summary, turns: [] as Turn[], compactions: [] as Compaction[] };
}

const ROOT = "~/.claude/projects";

export class ClaudeCodeAdapter implements SessionAdapter {
  readonly id: AgentSource = "claude-code";
  readonly label = "Claude Code";
  readonly vendor = "anthropic";
  readonly fidelity = claudeCodeFidelity;

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
    const all = await listFiles(this.root, (name) => name.endsWith(".jsonl"));
    // R1c: subagent transcripts are excluded from top-level selection — they roll
    // up into their parent's receipt, never appear as standalone sessions.
    // SPEC-0041 R1: the exclusion covers ANY `.jsonl` under `subagents/`, not
    // just `agent-*.jsonl` — workflow journals etc. are not sessions. Scoped
    // below the adapter root so an ancestor dir named `subagents` never
    // excludes the whole corpus.
    const files = all.filter((file) => !isUnderSubagents(file, this.root));
    const results = await mapWithConcurrency(files, 16, async (file) => {
      try {
        const stat = await this.discoveryFs.stat(file);
        if (stat.size === 0) {
          return null;
        }
        if (!options.full) {
          const firstLine = await this.discoveryFs.readFirstLine(file);
          const childRef = parseChildPath(file);
          return {
            ...lazyClaudeCodeSummary({ filePath: file, source: this.id, stat, firstLine }),
            parentSessionId: childRef?.parentSessionId,
            agentId: childRef?.agentId,
            parentFilePath: childRef?.parentFilePath,
          };
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
      const { summary, turns, compactions } = await parseTranscript(id, true);
      return { ...summary, turns, compactions };
    } catch {
      return null;
    }
  }
}
