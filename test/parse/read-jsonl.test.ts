import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readJsonl } from "../../src/parse/util.js";

// SPEC-0044 B3 — readJsonl now RETURNS the count of malformed (skipped) lines so
// an adapter can record `session.droppedRecords`; a torn transcript's
// under-report becomes a visible caveat instead of a silent undercount. The same
// mechanism backs opencode's per-row `parseJsonObject`→null skip counter.
describe("readJsonl — dropped-record count", () => {
  async function withFile(contents: string, fn: (file: string) => Promise<void>): Promise<void> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "aireceipts-jsonl-"));
    try {
      const file = path.join(dir, "t.jsonl");
      await fs.writeFile(file, contents);
      await fn(file);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  it("counts only malformed lines; blank/whitespace lines are not records", async () => {
    await withFile(['{"a":1}', "", '{"b":2', "   ", "not json at all", '{"c":3}'].join("\n"), async (file) => {
      const seen: unknown[] = [];
      const dropped = await readJsonl(file, (r) => seen.push(r));
      expect(dropped).toBe(2); // '{"b":2' and 'not json at all'
      expect(seen).toEqual([{ a: 1 }, { c: 3 }]); // valid records still yielded
    });
  });

  it("a clean file drops nothing", async () => {
    await withFile('{"a":1}\n{"b":2}\n', async (file) => {
      expect(await readJsonl(file, () => {})).toBe(0);
    });
  });
});
