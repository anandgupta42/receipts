// SPEC-0011 R1/R4: doc ↔ schema parity. `docs/json-schema.md` is a hand-written
// mirror of `src/receipt/exportSchema.ts`; this test is the machinery that keeps
// them honest. It fails the build when (a) the documented version drifts from
// `SCHEMA_VERSION`, or (b) the set of documented field names differs from the
// schema's field names in either direction (a schema field added/renamed/removed
// without a matching doc edit, or a stale doc field). This is the R4 semver
// guard: "bumped schemaVersion, stale docs → parity test fails build."
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SCHEMA_VERSION, allExportFieldNames, collectFieldNames } from "../../src/receipt/exportSchema.js";

const docPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/json-schema.md");
const doc = readFileSync(docPath, "utf8");

/** The documented version, from the machine anchor `<!-- SCHEMA_VERSION: N -->`. */
function documentedVersion(md: string): number {
  const match = md.match(/<!--\s*SCHEMA_VERSION:\s*(\d+)\s*-->/);
  if (!match) {
    throw new Error("docs/json-schema.md is missing its `<!-- SCHEMA_VERSION: N -->` anchor");
  }
  return Number(match[1]);
}

/** Every field name documented inside the `json-fields` markers — the first-column code span of each table row. CSV column tables live outside the markers and are intentionally excluded. */
function documentedFieldNames(md: string): Set<string> {
  const region = md.match(/<!--\s*json-fields:start\s*-->([\s\S]*?)<!--\s*json-fields:end\s*-->/);
  if (!region) {
    throw new Error("docs/json-schema.md is missing its `json-fields` start/end markers");
  }
  const names = new Set<string>();
  for (const line of region[1].split("\n")) {
    const cell = line.match(/^\|\s*`([^`]+)`\s*\|/);
    if (cell) {
      names.add(cell[1]);
    }
  }
  return names;
}

describe("R4: JSON schema version parity", () => {
  it("the documented version equals SCHEMA_VERSION", () => {
    expect(documentedVersion(doc)).toBe(SCHEMA_VERSION);
  });
});

describe("R1/R4: JSON schema field parity", () => {
  const documented = documentedFieldNames(doc);
  const schemaNames = allExportFieldNames();

  it("every schema field is documented (no undocumented field ships)", () => {
    const missing = [...schemaNames].filter((n) => !documented.has(n)).sort();
    expect(missing).toEqual([]);
  });

  it("every documented field exists in the schema (no stale doc field)", () => {
    const stale = [...documented].filter((n) => !schemaNames.has(n)).sort();
    expect(stale).toEqual([]);
  });
});

describe("R4: the field walker actually detects a shape change", () => {
  it("collectFieldNames surfaces a newly added field (proves the guard would fire)", () => {
    const base = z.object({ a: z.number() }).strict();
    const changed = z.object({ a: z.number(), b: z.string() }).strict();
    expect([...collectFieldNames(base)].sort()).toEqual(["a"]);
    expect([...collectFieldNames(changed)].sort()).toEqual(["a", "b"]);
  });

  it("collectFieldNames descends through arrays, unions, and nullable wrappers", () => {
    const schema = z
      .object({
        wrapped: z.object({ inner: z.number() }).nullable(),
        list: z.array(z.object({ leaf: z.string() }).strict()),
        oneOf: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("x"), only_x: z.number() }).strict(),
          z.object({ kind: z.literal("y"), only_y: z.number() }).strict(),
        ]),
      })
      .strict();
    expect([...collectFieldNames(schema)].sort()).toEqual([
      "inner",
      "kind",
      "leaf",
      "list",
      "oneOf",
      "only_x",
      "only_y",
      "wrapped",
    ]);
  });
});
