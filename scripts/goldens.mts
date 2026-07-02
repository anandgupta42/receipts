// Golden receipt generator/verifier. `--verify` (default) byte-compares fresh
// renders of every eval-corpus fixture against goldens/; `--update` rewrites
// them. Run with frozen env: NO_COLOR=1 TZ=UTC LANG=C (the caller enforces it).
import { loadById } from "../src/index.js";
import { buildReceiptModel } from "../src/receipt/model.js";
import { renderReceipt } from "../src/receipt/render.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const update = process.argv.includes("--update");
const corpus = JSON.parse(readFileSync("eval/corpus.json", "utf8")).entries as
  { source: string; path: string }[];

let drift = 0;
for (const e of corpus) {
  const session = await loadById(e.source, e.path);
  if (!session) { console.error(`goldens: failed to load ${e.path}`); process.exit(1); }
  const rendered = renderReceipt(await buildReceiptModel(session), { color: false }) + "\n";
  const file = `goldens/${e.source}-${e.path.split("/").pop()!.replace(/\.jsonl$/, "")}.txt`;
  if (update) { writeFileSync(file, rendered); console.log("updated:", file); continue; }
  if (!existsSync(file)) { console.error(`goldens: missing ${file} (run --update)`); drift++; continue; }
  if (readFileSync(file, "utf8") !== rendered) { console.error(`goldens: DRIFT in ${file}`); drift++; }
}
if (drift > 0) process.exit(1);
if (!update) console.log(`goldens: ${corpus.length} receipts byte-identical.`);
