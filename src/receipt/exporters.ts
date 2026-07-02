// SPEC-0011 R6: the exporter seam. One `Exporter` interface + an id-keyed
// registry, so every one-shot output format is a small object that consumes the
// already-computed `ReceiptModel` and returns a string — the render path never
// grows a new branch per format, and a future exporter (OTLP among them, cut to
// its own spec) plugs in here without touching the CLI or the receipt engine.
//
// Facts-only (R2 discipline, mirrors SPEC-0010's OTEL exporter): an exporter
// serializes what the model already holds; it never recomputes pricing,
// re-ranks, or fabricates a field. Single-session only — `compare` needs two
// models and has its own `toCompare*` functions.
import { toSessionCsv, toToolCsv } from "./csv.js";
import { toJsonModel } from "./json.js";
import type { ReceiptModel } from "./model.js";

export interface Exporter {
  /** Stable selector used by the CLI (`--json` → `json`, `--csv=tool` → `csv-tool`). */
  readonly id: string;
  /** Serialize one receipt model to its format's text (no trailing newline — the caller owns line termination). */
  export(model: ReceiptModel): string;
}

const jsonExporter: Exporter = {
  id: "json",
  export: (model) => JSON.stringify(toJsonModel(model), null, 2),
};

const csvSessionExporter: Exporter = {
  id: "csv-session",
  export: (model) => toSessionCsv(model),
};

const csvToolExporter: Exporter = {
  id: "csv-tool",
  export: (model) => toToolCsv(model),
};

const REGISTRY: Exporter[] = [jsonExporter, csvSessionExporter, csvToolExporter];

const EXPORTERS_BY_ID: Record<string, Exporter> = Object.fromEntries(REGISTRY.map((e) => [e.id, e]));

/** Look up an exporter by id; `undefined` for an unregistered id (the caller decides how to error). */
export function getExporter(id: string): Exporter | undefined {
  return EXPORTERS_BY_ID[id];
}

/** All registered exporter ids — for tests and any "list formats" surface. */
export function exporterIds(): string[] {
  return REGISTRY.map((e) => e.id);
}

/**
 * Register an exporter for the lifetime of the process (test seam proof, R6):
 * a caller can register a new id and select it exactly like the built-ins,
 * receiving the same `ReceiptModel`. Returns a disposer that removes it again,
 * so tests never leak a registration into another test.
 */
export function registerExporter(exporter: Exporter): () => void {
  const previous = EXPORTERS_BY_ID[exporter.id];
  EXPORTERS_BY_ID[exporter.id] = exporter;
  return () => {
    if (previous) {
      EXPORTERS_BY_ID[exporter.id] = previous;
    } else {
      delete EXPORTERS_BY_ID[exporter.id];
    }
  };
}
