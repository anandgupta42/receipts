// Golden receipt generator/verifier. `--verify` (default) byte-compares fresh
// renders of every eval-corpus fixture against goldens/; `--update` rewrites
// them. Covers the terminal receipt (goldens/*.txt) AND the SVG export
// (goldens/svg/*.svg — a priced fixture in both themes plus a compare card;
// SPEC-0003 I5). Run with frozen env: NO_COLOR=1 TZ=UTC LANG=C (the caller
// enforces it).
import { loadById } from "../src/index.js";
import type { AgentSource } from "../src/index.js";
import { buildReceiptModel } from "../src/receipt/model.js";
import type { ReceiptModel } from "../src/receipt/model.js";
import { renderReceipt } from "../src/receipt/render.js";
import { renderReceiptSvg, renderCompareSvg } from "../src/receipt/svg.js";
import { renderMiniReceipt } from "../src/receipt/mini.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const update = process.argv.includes("--update");
const corpus = JSON.parse(readFileSync("eval/corpus.json", "utf8")).entries as
  { source: AgentSource; path: string }[];

mkdirSync("goldens/mini", { recursive: true });
let drift = 0;
let count = 0;

/** Byte-compare (or rewrite under --update) one golden file. */
function check(file: string, content: string): void {
  count++;
  if (update) {
    writeFileSync(file, content);
    console.log("updated:", file);
    return;
  }
  if (!existsSync(file)) {
    console.error(`goldens: missing ${file} (run --update)`);
    drift++;
    return;
  }
  if (readFileSync(file, "utf8") !== content) {
    console.error(`goldens: DRIFT in ${file}`);
    drift++;
  }
}

for (const e of corpus) {
  const session = await loadById(e.source, e.path);
  if (!session) { console.error(`goldens: failed to load ${e.path}`); process.exit(1); }
  const model = await buildReceiptModel(session);
  const stem = `${e.source}-${e.path.split("/").pop()!.replace(/\.jsonl$/, "")}`;
  check(`goldens/${stem}.txt`, renderReceipt(model, { color: false }) + "\n");
  check(`goldens/mini/${stem}.txt`, renderMiniReceipt(model) + "\n");
}

async function modelFor(source: AgentSource, path: string): Promise<ReceiptModel> {
  const session = await loadById(source, path);
  if (!session) {
    console.error(`goldens: failed to load ${path}`);
    process.exit(1);
  }
  return buildReceiptModel(session);
}

const nameOf = (path: string): string => path.split("/").pop()!.replace(/\.jsonl$/, "");

// SVG export — a priced fixture in both themes, plus a two-card compare (SPEC-0003).
mkdirSync("goldens/svg", { recursive: true });
const PRICED = { source: "claude-code" as AgentSource, path: "test/fixtures/claude-code/clean-multi-tool-2-models.jsonl" };
const LOOP = { source: "claude-code" as AgentSource, path: "test/fixtures/claude-code/loop-bash-5x.jsonl" };
const pricedModel = await modelFor(PRICED.source, PRICED.path);
for (const theme of ["light", "dark"] as const) {
  check(`goldens/svg/${PRICED.source}-${nameOf(PRICED.path)}-${theme}.svg`, renderReceiptSvg(pricedModel, { theme }));
}
const loopModel = await modelFor(LOOP.source, LOOP.path);
check(`goldens/svg/compare-${nameOf(PRICED.path)}-vs-${nameOf(LOOP.path)}.svg`, renderCompareSvg(pricedModel, loopModel));

if (drift > 0) process.exit(1);
if (!update) console.log(`goldens: ${count} artifacts byte-identical.`);
