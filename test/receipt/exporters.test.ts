// SPEC-0011 R6: the exporter seam. Proves id-based selection, that the built-in
// exporters are registered, and the seam property — a test-registered second
// exporter, selected by id, receives the same `ReceiptModel` the CSV/JSON
// exporters consume (so a future exporter plugs in without touching the render
// path).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/index.js";
import type { ReceiptModel } from "../../src/receipt/model.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { exporterIds, getExporter, registerExporter, type Exporter } from "../../src/receipt/exporters.js";
import { toJsonModel } from "../../src/receipt/json.js";
import { toSessionCsv } from "../../src/receipt/csv.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

async function sampleModel(): Promise<ReceiptModel> {
  const session = await loadById("claude-code", path.join(fixturesDir, "claude-code/clean-multi-tool-2-models.jsonl"));
  if (!session) {
    throw new Error("failed to load fixture");
  }
  return buildReceiptModel(session);
}

describe("R6: exporter registry", () => {
  it("registers the built-in json and csv exporters", () => {
    expect(exporterIds().sort()).toEqual(["csv-session", "csv-tool", "json"]);
  });

  it("selects an exporter by id and returns its serialization", async () => {
    const model = await sampleModel();
    expect(getExporter("json")?.export(model)).toBe(JSON.stringify(toJsonModel(model), null, 2));
    expect(getExporter("csv-session")?.export(model)).toBe(toSessionCsv(model));
  });

  it("returns undefined for an unregistered id", () => {
    expect(getExporter("xml")).toBeUndefined();
  });

  it("a test-registered second exporter, selected by id, receives the same ReceiptModel (seam proof)", async () => {
    const model = await sampleModel();
    let received: ReceiptModel | undefined;
    const probe: Exporter = {
      id: "test-probe",
      export: (m) => {
        received = m;
        return `sessionId=${m.sessionId}`;
      },
    };
    const dispose = registerExporter(probe);
    try {
      const selected = getExporter("test-probe");
      expect(selected).toBe(probe);
      const out = selected?.export(model);
      expect(received).toBe(model); // same object the built-ins would consume
      expect(out).toBe(`sessionId=${model.sessionId}`);
    } finally {
      dispose();
    }
    expect(getExporter("test-probe")).toBeUndefined(); // registration didn't leak
  });
});
