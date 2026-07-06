// SPEC-0018 R4: byte-safe help assembly. Each command contributes its own Usage
// block (`CommandDef.help`, placed by `order`); the masthead, footer, and the
// cross-cutting output-mode illustration lines (`--svg`/`--png`/`compare --svg`/
// `--template`) are fixed literals owned here under common ownership (R7). A new
// command self-registers its help line in its own file — it never edits this
// module — while `goldens/cli/help.txt` gates the assembled bytes.
import type { CommandDef, HelpEntry } from "./types.js";

const HEADER = "aireceipts — local, deterministic cost receipts for AI coding-agent sessions\n\nUsage:";

const FOOTER = [
  "flags: --svg renders an SVG file; --png rasterizes it (receipt only, not compare);",
  "       --theme light|dark picks the palette (default light); -o/--output names the file.",
  "--csv[=session|tool]: export CSV (session summary rows, or one row per tool).",
  "selector: a 1-based index into --list, a session id, or a title substring.",
].join("\n");

/**
 * Output-mode illustration lines that sit in the Usage body but aren't commands.
 * Their `order` values interleave with the command help entries to reproduce the
 * curated layout (svg=60, png=70, compare-svg=80, template=130).
 */
const OUTPUT_MODE_ENTRIES: readonly HelpEntry[] = [
  { order: 60, lines: ["  aireceipts [selector] --svg [-o f]    write a shareable SVG receipt (default receipt.svg)"] },
  { order: 70, lines: ["  aireceipts [selector] --png [-o f]    write a rasterized PNG receipt (default receipt.png)"] },
  { order: 80, lines: ["  aireceipts compare <a> <b> --svg      write a side-by-side SVG (default compare.svg)"] },
  { order: 130, lines: ["  aireceipts [selector] --template <name>  render a receipt style (classic|grocery|datavis)"] },
  {
    order: 135,
    lines: [
      "  aireceipts [selector] --details       add a DETAILS section (token composition, session",
      "                                         shape, per-model split; classic template only)",
    ],
  },
];

/**
 * Assemble `--help` from the loaded commands: gather every non-hidden command's
 * help entry plus the shared output-mode entries, sort by `order`, join the
 * literal lines, and sandwich them between the fixed masthead and footer. The
 * result is byte-identical to `goldens/cli/help.txt` (verified by the R8
 * preservation suite).
 */
export function assembleHelp(commands: readonly CommandDef[]): string {
  const entries: HelpEntry[] = [...OUTPUT_MODE_ENTRIES];
  for (const command of commands) {
    if (command.help) {
      entries.push(command.help);
    }
  }
  entries.sort((a, b) => a.order - b.order);
  const body = entries.flatMap((entry) => entry.lines).join("\n");
  return `${HEADER}\n${body}\n\n${FOOTER}`;
}
