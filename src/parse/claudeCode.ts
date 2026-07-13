import type {
  AgentSource,
  Compaction,
  ListSessionsOptions,
  Session,
  SessionAdapter,
  SessionSummary,
  TokenUsage,
  ToolCall,
  Turn,
} from "./types.js";
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
  safeTokenSum,
  truncate,
  sanitizeText,
  withTotal,
} from "./util.js";

/** Raw shapes from a Claude Code `.jsonl` transcript line. Only the fields we use. */
interface RawUsage {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  /** Newer Claude Code sessions split the flat `cache_creation_input_tokens` total by ephemeral TTL tier. Older sessions omit this object entirely. */
  cache_creation?: unknown;
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
  /** The API message id (`msg_…`). One observable response group = one id, even when the CLI writes several records for it. */
  id?: string;
  model?: string;
  content?: unknown;
  usage?: unknown;
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
interface MappedClaudeUsage {
  usage?: TokenUsage;
  malformed: boolean;
}

interface ParsedTokenField {
  value: number;
  present: boolean;
  valid: boolean;
}

function tokenField(owner: Record<string, unknown>, key: string): ParsedTokenField {
  if (!Object.prototype.hasOwnProperty.call(owner, key)) {
    return { value: 0, present: false, valid: true };
  }
  const value = owner[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? { value, present: true, valid: true }
    : { value: 0, present: true, valid: false };
}

/**
 * Preserve every independently valid component from a malformed usage object,
 * but flag the coherent snapshot as non-priceable. Missing fields are valid
 * zeroes; present null/string/fractional/negative/unsafe values are not.
 */
function mapUsage(raw: unknown, present: boolean): MappedClaudeUsage {
  if (!present) {
    return { malformed: false };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { usage: emptyUsage(), malformed: true };
  }
  const usage = raw as RawUsage & Record<string, unknown>;
  const input = tokenField(usage, "input_tokens");
  const output = tokenField(usage, "output_tokens");
  const cacheRead = tokenField(usage, "cache_read_input_tokens");
  const flatCacheCreation = tokenField(usage, "cache_creation_input_tokens");

  let splitMalformed = false;
  let cacheCreation5m: ParsedTokenField = { value: 0, present: false, valid: true };
  let cacheCreation1h: ParsedTokenField = { value: 0, present: false, valid: true };
  if (Object.prototype.hasOwnProperty.call(usage, "cache_creation")) {
    const split = usage.cache_creation;
    if (!split || typeof split !== "object" || Array.isArray(split)) {
      splitMalformed = true;
    } else {
      const splitRecord = split as Record<string, unknown>;
      cacheCreation5m = tokenField(splitRecord, "ephemeral_5m_input_tokens");
      cacheCreation1h = tokenField(splitRecord, "ephemeral_1h_input_tokens");
      splitMalformed = !cacheCreation5m.valid || !cacheCreation1h.valid;
    }
  }

  const splitSum = safeTokenSum([cacheCreation5m.value, cacheCreation1h.value]);
  if (splitSum === undefined) {
    return { usage: emptyUsage(), malformed: true };
  }
  const cacheCreation = flatCacheCreation.valid && flatCacheCreation.present
    ? flatCacheCreation.value
    : splitSum;
  if (safeTokenSum([input.value, output.value, cacheRead.value, cacheCreation]) === undefined) {
    return { usage: emptyUsage(), malformed: true };
  }
  const splitFitsTotal = splitSum <= cacheCreation;
  const malformed =
    !input.valid ||
    !output.valid ||
    !cacheRead.valid ||
    !flatCacheCreation.valid ||
    splitMalformed ||
    !splitFitsTotal;

  return {
    malformed,
    usage: withTotal({
      input: input.value,
      output: output.value,
      cacheRead: cacheRead.value,
      cacheCreation,
      // A contradictory split is excluded as a breakdown rather than clamped.
      cacheCreation5m: splitFitsTotal && cacheCreation5m.present && cacheCreation5m.valid
        ? cacheCreation5m.value
        : undefined,
      cacheCreation1h: splitFitsTotal && cacheCreation1h.present && cacheCreation1h.valid
        ? cacheCreation1h.value
        : undefined,
      total: 0,
    }),
  };
}

/**
 * Claude Code can emit several records for one API response. Most repeat the
 * same usage, but the Agent SDK documents that later records can carry a
 * higher output count. Anthropic's documented rule is specifically to retain
 * the response carrying the highest output count. Keep that record's complete
 * usage vector together; independently maximizing input/cache buckets could
 * fabricate a combination that no trace record ever reported. On an output
 * tie, the later record wins as the final coherent snapshot.
 */
function mergeUsageSnapshot(current: TokenUsage | undefined, next: TokenUsage | undefined): TokenUsage | undefined {
  if (!current) {
    return next;
  }
  if (!next) {
    return current;
  }
  return next.output >= current.output ? next : current;
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
  const turns: Turn[] = [];
  let anonymousValidUsage: TokenUsage | undefined;
  let anonymousMalformedUsage: TokenUsage | undefined;
  let malformedUsageRecords = 0;
  const toolCallById = new Map<string, ToolCall>();
  // One observable assistant response group = one turn, keyed by `message.id`. Claude Code
  // writes one `assistant` record per content block. Records of the same
  // response repeat the id, but usage snapshots are not guaranteed identical:
  // the Agent SDK explicitly says to retain the highest cumulative value when
  // duplicate ids disagree. The coherent snapshot with the highest output is
  // retained; counting records would multiply cost, while keeping the first
  // would miss later output. Tool blocks still merge into the single turn.
  const turnByMessageId = new Map<string, Turn>();
  const turnsWithValidUsage = new Set<Turn>();
  const malformedUsageByTurn = new Map<Turn, TokenUsage>();
  // SPEC-0017 R1/R2 — one entry per distinct next-assistant-turn index that a
  // compact summary/boundary record precedes. Keyed by `turnIndex` so an echo +
  // summary (or two summary shapes) at the same position collapse to one event.
  const compactionByTurn = new Map<number, number | undefined>();

  const jsonDroppedRecords = await readJsonl(filePath, (raw) => {
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
      turnByMessageId.clear();
      turnsWithValidUsage.clear();
      malformedUsageByTurn.clear();
      anonymousValidUsage = undefined;
      anonymousMalformedUsage = undefined;
      malformedUsageRecords = 0;
      compactionByTurn.clear();
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
      // CLI-injected command echo, not a billed model response.
      if (typeof msg.content === "string" && COMMAND_ECHO_RE.test(msg.content)) {
        return;
      }
      model ??= msg.model;

      // Reuse the open turn for this message id (see `turnByMessageId`); a
      // record without an id can't be matched to a response, so it stays its
      // own turn.
      const existing = msg.id !== undefined ? turnByMessageId.get(msg.id) : undefined;
      const turn: Turn = existing ?? { index: turns.length, timestamp: ts, model: msg.model, toolCalls: [] };
      if (!existing) {
        turns.push(turn);
        if (msg.id !== undefined) {
          turnByMessageId.set(msg.id, turn);
        }
      }
      turn.model ??= msg.model;
      const mappedUsage = mapUsage(msg.usage, Object.prototype.hasOwnProperty.call(msg, "usage"));
      if (mappedUsage.malformed) {
        malformedUsageRecords++;
      }
      if (msg.id === undefined) {
        // Without the provider response id, repeated content snapshots cannot
        // be distinguished from separate requests. Retain one coherent
        // highest-output usage vector as unattributed tokens and never attach
        // a price to these anonymous records.
        if (mappedUsage.malformed) {
          anonymousMalformedUsage = mergeUsageSnapshot(anonymousMalformedUsage, mappedUsage.usage);
        } else {
          anonymousValidUsage = mergeUsageSnapshot(anonymousValidUsage, mappedUsage.usage);
        }
      } else {
        let usage: TokenUsage | undefined;
        if (mappedUsage.malformed) {
          const malformedUsage = mergeUsageSnapshot(malformedUsageByTurn.get(turn), mappedUsage.usage);
          if (malformedUsage) {
            malformedUsageByTurn.set(turn, malformedUsage);
          }
          if (!turnsWithValidUsage.has(turn)) {
            usage = malformedUsage;
            // An empty explicit unit is a shared pricing safe-stop while the
            // valid token components remain visible on the turn.
            turn.pricingUnits = [];
          }
        } else if (mappedUsage.usage) {
          usage = turnsWithValidUsage.has(turn)
            ? mergeUsageSnapshot(turn.usage, mappedUsage.usage)
            : mappedUsage.usage;
          turnsWithValidUsage.add(turn);
          delete turn.pricingUnits;
        }
        if (usage) {
          turn.usage = usage;
          turn.outputTokens = usage.output;
        }
      }

      if (Array.isArray(msg.content)) {
        for (const block of msg.content as RawContentBlock[]) {
          if (block.type === "tool_use") {
            // Cumulative/parallel snapshots may repeat a previously emitted
            // tool block. A provider tool-use id identifies the logical call;
            // id-less blocks cannot be matched safely and remain distinct.
            if (block.id && toolCallById.has(block.id)) {
              continue;
            }
            const call: ToolCall = {
              name: sanitizeText(block.name ?? "tool"),
              input: block.input,
              status: "running",
              startedAt: ts,
              ...(block.name === "Bash" ? { shell: true } : {}),
            };
            turn.toolCalls.push(call);
            if (block.id) {
              toolCallById.set(block.id, call);
            }
          }
        }
      }
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

  const droppedRecords = jsonDroppedRecords + malformedUsageRecords;
  const anonymousUsage = anonymousValidUsage ?? anonymousMalformedUsage ?? emptyUsage();

  // Totals are derived only after every duplicate snapshot has been merged.
  // This also makes a fork reset authoritative: pre-marker turns are removed
  // before either usage or tool counts are accumulated.
  const itemizedUsage = turns.reduce(
    (total, turn) => (turn.usage ? addUsage(total, turn.usage) : total),
    emptyUsage(),
  );
  const totalUsage = addUsage(itemizedUsage, anonymousUsage);
  const toolCallCount = turns.reduce((total, turn) => total + turn.toolCalls.length, 0);
  const totals = {
    tokens: totalUsage,
    durationMs: startedAt !== undefined && endedAt !== undefined ? endedAt - startedAt : undefined,
    turnCount: turns.length,
    toolCallCount,
  };

  // R1c: a subagent transcript is a child either by disk layout or by the raw
  // `isSidechain` marker; child linkage comes from the path (the disk layout is
  // the discovery contract).
  const childRef = parseChildPath(filePath);
  const summary: SessionSummary = {
    id: filePath,
    source: "claude-code",
    title: (aiTitle ? truncate(aiTitle) : undefined) || (firstUserText ? truncate(firstUserText) : undefined),
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

  return withTurns
    ? {
        summary,
        turns,
        compactions,
        droppedRecords,
        ...(anonymousUsage.total > 0 ? { unattributedUsage: anonymousUsage } : {}),
      }
    : { summary, turns: [] as Turn[], compactions: [] as Compaction[], droppedRecords: 0 };
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
    // SPEC-0075 R1 — scoped callers provide exact encoded project directories;
    // the default remains the single adapter root, preserving global discovery.
    const discoveryRoots = options.roots ?? [this.root];
    const all = (
      await Promise.all([...new Set(discoveryRoots)].map((root) => listFiles(root, (name) => name.endsWith(".jsonl"))))
    ).flat();
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
      const { summary, turns, compactions, droppedRecords, unattributedUsage } = await parseTranscript(id, true);
      // SPEC-0044 B3: only present when > 0 (absent → clean), so a clean
      // session's shape is unchanged.
      return {
        ...summary,
        turns,
        compactions,
        ...(unattributedUsage ? { unattributedUsage } : {}),
        ...(droppedRecords > 0 ? { droppedRecords } : {}),
      };
    } catch {
      return null;
    }
  }
}
