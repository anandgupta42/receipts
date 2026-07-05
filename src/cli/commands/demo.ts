// SPEC-0051: `--demo` — render a bundled sample session through the real
// parse→price→render pipeline so a machine with no transcripts still sees a
// genuine receipt. stdout is the receipt (byte-identical to the README-hero
// golden with colour off); the "this is a sample" banner goes to stderr so
// stdout stays a pure receipt.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadById } from "../../index.js";
import { buildReceiptModel } from "../../receipt/model.js";
import { renderReceipt } from "../../receipt/render.js";
import type { AgentSource } from "../../parse/types.js";
import type { CommandContext, CommandDef } from "../types.js";

const DEMO_FIXTURE = "clean-multi-tool-2-models.jsonl";

const BANNER = [
  "demo · a sample session bundled with aireceipts — your own sessions render the same way.",
  "run `aireceipts` (no flags) once your agent has written a transcript. method: aireceipts --methodology",
].join("\n");

/**
 * Locate the shipped demo transcript by walking up from this module toward a
 * `data/demo/<fixture>` sibling — mirrors `priceTable.ts`'s `defaultDataDir`.
 * Works from `src/` (vitest) and from the bundled `dist/` (where `data/` ships
 * beside `dist/` per package.json `files`). Never depends on process CWD.
 */
function demoTranscriptPath(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "data", "demo", DEMO_FIXTURE);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

async function run(ctx: CommandContext): Promise<number> {
  const path = demoTranscriptPath();
  if (!path) {
    ctx.stderr.write("aireceipts: demo transcript not found (packaging error)\n");
    return 1;
  }
  const session = await loadById("claude-code" as AgentSource, path);
  if (!session) {
    ctx.stderr.write("aireceipts: demo transcript could not be parsed (packaging error)\n");
    return 1;
  }
  const model = await buildReceiptModel(session);
  ctx.stderr.write(`${BANNER}\n`);
  // No `color` option → same auto-detection (NO_COLOR / TTY) as the default
  // receipt command; the trailing newline matches how the golden is written.
  ctx.stdout.write(`${renderReceipt(model)}\n`);
  return 0;
}

export const command: CommandDef = {
  name: "demo",
  // Below telemetry-show (170) so `--telemetry-show --demo` still takes the
  // no-record preview path; above every session-selecting command so `--demo`
  // short-circuits discovery.
  priority: 165,
  matches: (options) => options.demo,
  run,
  help: {
    order: 15,
    lines: ["  aireceipts --demo                     render a bundled sample receipt (no sessions needed)"],
  },
};
