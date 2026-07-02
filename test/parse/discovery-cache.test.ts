import { open, mkdtemp, mkdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeCodeAdapter } from "../../src/parse/claudeCode.js";
import type { DiscoveryFs } from "../../src/parse/discovery.js";
import { completeSummariesWithCache } from "../../src/parse/summaryCache.js";
import type { SessionSummary } from "../../src/parse/types.js";

const tmpRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function isoAt(i: number, seconds: number): string {
  const hour = 9 + Math.floor(i / 60);
  const minute = i % 60;
  return `2026-06-18T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.000Z`;
}

function userLine(i: number, timestamp = isoAt(i, 0)): string {
  return JSON.stringify({
    type: "user",
    uuid: `u-${i}`,
    timestamp,
    sessionId: `sess-${i}`,
    cwd: "/repo/app",
    gitBranch: "main",
    message: { role: "user", content: `Implement task ${i}` },
  });
}

function assistantLine(i: number, extra = ""): string {
  return JSON.stringify({
    type: "assistant",
    uuid: `a-${i}`,
    timestamp: isoAt(i, 30),
    sessionId: `sess-${i}`,
    cwd: "/repo/app",
    gitBranch: "main",
    message: {
      role: "assistant",
      model: "claude-opus-4-8",
      content: [{ type: "tool_use", id: `tool-${i}`, name: "Bash", input: { command: "npm test", extra } }],
      usage: { input_tokens: 100 + i, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 },
    },
  });
}

async function writeClaudeTranscript(root: string, name: string, i: number, extra = ""): Promise<string> {
  const filePath = path.join(root, name);
  await writeFile(filePath, `${userLine(i)}\n${assistantLine(i, extra)}\n`, "utf8");
  const mtime = new Date(Date.UTC(2026, 5, 18, 10, i, 0));
  await utimes(filePath, mtime, mtime);
  return filePath;
}

async function writeCacheEntry(cachePath: string, filePath: string, summary: unknown): Promise<void> {
  const s = await stat(filePath);
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(
    cachePath,
    `${JSON.stringify(
      {
        version: 1,
        entries: {
          [filePath]: { mtimeMs: s.mtimeMs, size: s.size, summary },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

describe("lazy discovery + summary cache", () => {
  it("reuses cached full summaries without changing the uncached parser answer, even after corrupt cache input", async () => {
    const root = await tempRoot("aireceipts-cache-");
    await writeClaudeTranscript(root, "one.jsonl", 1);
    await writeClaudeTranscript(root, "two.jsonl", 2);
    const cachePath = path.join(root, ".aireceipts", "cache.json");
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, "{not json", "utf8");

    const adapter = new ClaudeCodeAdapter({ root });
    const lazy = await adapter.listSessions();
    const uncached = await adapter.listSessions({ full: true });
    const first = await completeSummariesWithCache(lazy, {
      cachePath,
      stat,
      load: (summary) => adapter.loadSession(summary.id),
    });

    let loads = 0;
    const second = await completeSummariesWithCache(lazy, {
      cachePath,
      stat,
      load: async () => {
        loads++;
        return null;
      },
    });

    expect(first).toEqual(uncached);
    expect(second).toEqual(uncached);
    expect(loads).toBe(0);
  });

  it.each([
    {
      name: "startedAt is not numeric",
      corrupt: (s: SessionSummary) => ({ ...s, startedAt: "2026-06-18T10:00:00Z" }),
    },
    {
      name: "unpriceable is not boolean",
      corrupt: (s: SessionSummary) => ({ ...s, unpriceable: "false" }),
    },
    {
      name: "parentFilePath is not a string",
      corrupt: (s: SessionSummary) => ({ ...s, parentFilePath: 123 }),
    },
    {
      name: "gitBranch is not a string",
      corrupt: (s: SessionSummary) => ({ ...s, gitBranch: { name: "main" } }),
    },
  ])("drops a matching cache entry when the cached SessionSummary is corrupt: $name", async ({ corrupt }) => {
    const root = await tempRoot("aireceipts-cache-corrupt-");
    const transcript = await writeClaudeTranscript(root, "one.jsonl", 1);
    const cachePath = path.join(root, ".aireceipts", "cache.json");
    const adapter = new ClaudeCodeAdapter({ root });
    const lazy = await adapter.listSessions();
    const uncached = await adapter.listSessions({ full: true });
    await writeCacheEntry(cachePath, transcript, corrupt(uncached[0]));

    let loads = 0;
    const repaired = await completeSummariesWithCache(lazy, {
      cachePath,
      stat,
      load: async (summary) => {
        loads++;
        return adapter.loadSession(summary.id);
      },
    });

    expect(repaired).toEqual(uncached);
    expect(loads).toBe(1);
  });

  it("discovers a synthetic 200-file corpus by reading first lines instead of full transcript bodies", async () => {
    const root = await tempRoot("aireceipts-lazy-");
    const largeBody = "x".repeat(64 * 1024);
    for (let i = 0; i < 200; i++) {
      await writeClaudeTranscript(root, `${String(i).padStart(3, "0")}.jsonl`, i, largeBody);
    }

    let bytesRead = 0;
    let firstLineReads = 0;
    const trackingFs: DiscoveryFs = {
      stat,
      readFirstLine: async (filePath) => {
        firstLineReads++;
        const handle = await open(filePath, "r");
        try {
          const chunks: Buffer[] = [];
          let offset = 0;
          while (true) {
            const buffer = Buffer.alloc(256);
            const result = await handle.read(buffer, 0, buffer.length, offset);
            if (result.bytesRead === 0) {
              break;
            }
            bytesRead += result.bytesRead;
            const newline = buffer.indexOf(10, 0);
            const take = newline >= 0 && newline < result.bytesRead ? newline : result.bytesRead;
            chunks.push(buffer.subarray(0, take));
            if (newline >= 0 && newline < result.bytesRead) {
              break;
            }
            offset += result.bytesRead;
          }
          return Buffer.concat(chunks).toString("utf8");
        } finally {
          await handle.close();
        }
      },
    };

    const adapter = new ClaudeCodeAdapter({ root, fs: trackingFs });
    const summaries = await adapter.listSessions();
    const corpusBytes = (
      await Promise.all(summaries.map((summary) => stat(summary.filePath).then((s) => s.size)))
    ).reduce((sum, size) => sum + size, 0);

    expect(summaries).toHaveLength(200);
    expect(firstLineReads).toBe(200);
    expect(summaries.every((s) => s.totals.tokens.total === 0 && s.totals.toolCallCount === 0)).toBe(true);
    expect(bytesRead).toBeLessThan(corpusBytes / 20);
  });
});
