// SPEC-0019 R1a privacy rule — cwd/gitBranch and the child-index fields are
// attribution-only: present on the parse model, but NEVER in export schemas
// (--json/--csv), the rendered receipt, or the export field set (telemetry
// likewise carries no session content). This test is the assertion the spec
// requires.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/parse/load.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { summaryToJson, toJsonModel } from "../../src/receipt/json.js";
import { renderReceipt } from "../../src/receipt/render.js";
import { getExporter } from "../../src/receipt/exporters.js";
import { allExportFieldNames } from "../../src/receipt/exportSchema.js";

const CC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "claude-code");
const ATTRIBUTION_ONLY = ["cwd", "gitBranch", "isSidechain", "parentSessionId", "agentId", "parentFilePath"];

describe("R1a attribution-only fields never leak", () => {
  it("the export schema field set excludes every attribution-only field", () => {
    const fields = allExportFieldNames();
    for (const f of ATTRIBUTION_ONLY) {
      expect(fields.has(f)).toBe(false);
    }
  });

  it("--json, --csv, and the rendered receipt carry none of them", async () => {
    const session = (await loadById("claude-code", path.join(CC, "loop-bash-5x.jsonl")))!;
    // The model DOES carry cwd (proving it was parsed) — the leak surfaces must not.
    expect(session.cwd).toBeTruthy();

    const model = await buildReceiptModel(session);
    const json = JSON.stringify(toJsonModel(model));
    const listJson = JSON.stringify(summaryToJson(session));
    const receipt = renderReceipt(model, { color: false });
    const csv = getExporter("csv-session")!.export(model);

    for (const f of ATTRIBUTION_ONLY) {
      expect(json).not.toContain(f);
      expect(listJson).not.toContain(f);
      expect(csv).not.toContain(f);
    }
    // And no path/branch value bleeds into the rendered receipt.
    expect(receipt).not.toContain(session.cwd!);
    expect(receipt).not.toContain("fix/login-flake");
  });
});
