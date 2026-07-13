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
import { attachSubagentRollup } from "../src/receipt/subagents.js";
import { renderReceipt } from "../src/receipt/render.js";
import { renderReceiptSvg, renderCompareSvg } from "../src/receipt/svg.js";
import { renderMiniReceipt } from "../src/receipt/mini.js";
import { buildReviewReport, renderReview } from "../src/receipt/review.js";
import type { Session } from "../src/parse/types.js";
import { TEMPLATE_NAMES } from "../src/receipt/blocks.js";
import { renderPrArtifactHtml } from "../src/pr/html.js";
import { renderPerCommitLines } from "../src/pr/perCommit.js";
import type { ContributorView } from "../src/pr/body.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const update = process.argv.includes("--update");
const corpus = JSON.parse(readFileSync("eval/corpus.json", "utf8")).entries as
  { source: AgentSource; path: string }[];
const hostileCorpus = corpus.filter((e) => /\/hostile-[^/]+\.jsonl$/u.test(e.path));

mkdirSync("goldens/mini", { recursive: true });
let drift = 0;
let count = 0;
const loadedModels = new Map<string, ReceiptModel>();
const loadedSessions = new Map<string, Session>();
const nameOf = (path: string): string => path.split("/").pop()!.replace(/\.jsonl$/, "");

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
  // SPEC-0061 — compose the subagent rollup exactly as the CLI does; fixtures
  // without a `subagents/` dir return unchanged, so their goldens stay byte-stable.
  const model = await attachSubagentRollup(await buildReceiptModel(session), session.filePath);
  loadedSessions.set(`${e.source}:${e.path}`, session);
  loadedModels.set(`${e.source}:${e.path}`, model);
  const stem = `${e.source}-${e.path.split("/").pop()!.replace(/\.jsonl$/, "")}`;
  check(`goldens/${stem}.txt`, renderReceipt(model, { color: false }) + "\n");
  check(`goldens/mini/${stem}.txt`, renderMiniReceipt(model) + "\n");
}

// SPEC-0083 R14 — text and JSON review contracts across every eval-corpus
// source, including clean, priced, unpriced, loop, compaction, and hostile
// sessions. Reports are per-session here; recurrence has its own fixed-window
// unit fixtures.
mkdirSync("goldens/review", { recursive: true });
for (const e of corpus) {
  const session = loadedSessions.get(`${e.source}:${e.path}`);
  if (!session) {
    console.error(`goldens: missing loaded review session ${e.path}`);
    process.exit(1);
  }
  const stem = `${e.source}-${nameOf(e.path)}`;
  const report = await buildReviewReport(session);
  check(`goldens/review/${stem}.txt`, renderReview(report) + "\n");
  check(`goldens/review/${stem}.json`, JSON.stringify(report, null, 2) + "\n");
}

async function modelFor(source: AgentSource, path: string): Promise<ReceiptModel> {
  const session = await loadById(source, path);
  if (!session) {
    console.error(`goldens: failed to load ${path}`);
    process.exit(1);
  }
  return buildReceiptModel(session);
}

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

// SPEC-0020 R5: {grocery, datavis} × {terminal, SVG light} on the priced fixture
// (4 new artifacts). classic's existing goldens above are the refactor's
// regression gate; SVG dark stays classic-only.
const stem = `${PRICED.source}-${nameOf(PRICED.path)}`;
for (const template of ["grocery", "datavis"] as const) {
  check(`goldens/${stem}-${template}.txt`, renderReceipt(pricedModel, { color: false, template }) + "\n");
  check(`goldens/svg/${stem}-${template}-light.svg`, renderReceiptSvg(pricedModel, { theme: "light", template }));
}

// SPEC-0054 R9: the opt-in DETAILS view — the priced fixture (composition,
// counterfactual, BY MODEL) and the loop fixture (waste + details together) in
// terminal form, plus one SVG parity artifact for the priced fixture.
check(`goldens/${stem}-details.txt`, renderReceipt(pricedModel, { color: false, details: true }) + "\n");
check(`goldens/${LOOP.source}-${nameOf(LOOP.path)}-details.txt`, renderReceipt(loopModel, { color: false, details: true }) + "\n");
check(`goldens/svg/${stem}-details-light.svg`, renderReceiptSvg(pricedModel, { theme: "light", details: true }));

// Hostile fixtures are a visual-regression battery: every one renders through
// every receipt template in both terminal and SVG form, not only the default
// classic text path the eval corpus already covers.
for (const e of hostileCorpus) {
  const hostileModel = loadedModels.get(`${e.source}:${e.path}`) ?? (await modelFor(e.source, e.path));
  const hostileStem = `${e.source}-${nameOf(e.path)}`;
  for (const template of TEMPLATE_NAMES) {
    check(`goldens/${hostileStem}-${template}.txt`, renderReceipt(hostileModel, { color: false, template }) + "\n");
    check(`goldens/svg/${hostileStem}-${template}-light.svg`, renderReceiptSvg(hostileModel, { theme: "light", template }));
  }
}

// SPEC-0027 R1: the PR receipt artifact page — one two-session golden built
// from already-loaded fixture models with fixed provenance (I1/I5).
mkdirSync("goldens/html", { recursive: true });
function artifactView(role: ContributorView["role"], sessionId: string, model: ReceiptModel): ContributorView {
  return {
    role,
    sessionId,
    slice: { kind: "full", startTurn: 0, endTurn: 0, turnCount: 1, label: "entire session (slice unavailable)" },
    modelMix: model.modelMix,
    usd: model.totalUsd,
    tokens: model.totalTokens,
    subagents: [],
  };
}
const artifactViews = [artifactView("builder", "golden-builder", pricedModel), artifactView("builder", "golden-loop", loopModel)];
// SPEC-0031 R3 — the golden pins the per-commit surface: fixed rows through the
// real line renderer, the labeled bucket, and the inert template island.
const goldenPerCommitRows = [
  { shortSha: "abc1234", subject: "feat: golden first commit", turnCount: 3, usd: 0.12, totalTokens: 41000, extraCount: 0 },
  { shortSha: "def5678", subject: "fix: golden follow-up", turnCount: 2, usd: null, totalTokens: 9800, extraCount: 1 },
];
check(
  "goldens/html/pr-artifact.html",
  renderPrArtifactHtml({
    prNumber: 42,
    body: { contributors: artifactViews, excludedCount: 1 },
    sessions: artifactViews.map((v, i) => ({
      label: `${v.role} · ${v.sessionId}`,
      model: i === 0 ? pricedModel : loopModel,
      perCommitLines: i === 0 ? renderPerCommitLines(goldenPerCommitRows) : undefined,
    })),
    notAttributable: ["builder · golden-loop"],
    perCommitJson: JSON.stringify([{ session: "golden-builder", rows: goldenPerCommitRows }]),
  }),
);

if (drift > 0) process.exit(1);
if (!update) console.log(`goldens: ${count} artifacts byte-identical.`);
