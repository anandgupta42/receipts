import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadById } from "../../src/parse/load.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { toJsonModel } from "../../src/receipt/json.js";
import { receiptJsonSchema } from "../../src/receipt/exportSchema.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dataDir = path.join(repoRoot, "data/prices");
const fx = (name: string): string => path.join(repoRoot, "test/fixtures/claude-code", name);

// SPEC-0044 B3 — readJsonl used to `catch { continue }` on a malformed line with
// zero signal, so a crash-torn transcript credited into a receipt silently
// under-reported by the dropped record's usage. Now the count is threaded and
// the receipt says so (a lower bound), never a silent undercount.
describe("SPEC-0044 B3 — dropped transcript records surface, never silent", () => {
  it("a mid-stream malformed line is counted and caveated (session still credited)", async () => {
    const session = await loadById("claude-code", fx("dropped-record-midstream.jsonl"));
    expect(session).not.toBeNull();
    // one line (the truncated a-dropped-0003) is unparseable; the other three parse
    expect(session!.droppedRecords).toBe(1);

    const model = await buildReceiptModel(session!, dataDir);
    const caveat = model.caveats.find((c) => c.kind === "dropped-transcript-records");
    expect(caveat).toBeDefined();
    expect(caveat!.text).toContain("1 transcript record unreadable or malformed");
    // still priced from the surviving turns — the drop lowers the total, not the session
    expect(model.totalUsd).not.toBeNull();
    expect(model.totalUsd!).toBeGreaterThan(0);

    // --json stays schema-valid with the new caveat kind (Codex finding #4).
    const parsed = receiptJsonSchema.safeParse(toJsonModel(model));
    expect(parsed.success).toBe(true);
  });

  it("negative control: a clean transcript has no drop count and no caveat", async () => {
    const session = await loadById("claude-code", fx("hostile-markup-title.jsonl"));
    expect(session).not.toBeNull();
    expect(session!.droppedRecords ?? 0).toBe(0);
    const model = await buildReceiptModel(session!, dataDir);
    expect(model.caveats.some((c) => c.kind === "dropped-transcript-records")).toBe(false);
  });
});
