// R6 CLI arg parsing — hand-rolled per project constraint (no arg-parsing
// library in devDependencies). `--list`, `--json`, `--handoff`, `--help`/`-h`
// are flags; `compare` is the one subcommand, taking two positional
// selectors; anything else positional is the session selector for the
// default receipt command. `--svg` (SPEC-0003) switches the receipt and
// `compare` commands to SVG output; `--png` (SPEC-0012) rasterizes it, receipt
// command only; `-o`/`--output` names the file and `--theme light|dark` picks
// the palette.
export interface ParsedArgs {
  command: "receipt" | "list" | "compare" | "handoff" | "help" | "methodology" | "telemetry-show" | "quota" | "week" | "check-budget" | "benchmark" | "mini" | "install-hook" | "uninstall-hook" | "statusline" | "pr" | "templates";
  selector?: string;
  /** SPEC-0019: `aireceipts pr --post` posts the receipt comment (dry-run without it). */
  post?: boolean;
  /** SPEC-0019: `aireceipts pr --session <id>` — explicit session, bypassing auto-selection. */
  prSession?: string;
  compareA?: string;
  compareB?: string;
  json: boolean;
  /** SPEC-0003 R1/R3: render the receipt (or comparison) as an SVG file. */
  svg: boolean;
  /** SPEC-0003: SVG palette. */
  theme: "light" | "dark";
  /** SPEC-0003: output file for `--svg` (defaults to receipt.svg / compare.svg). */
  output?: string;
  /** SPEC-0012 R3: rasterize the receipt SVG to PNG (single-receipt only — R5 defers `compare --png`). */
  png: boolean;
  /** SPEC-0008 R4: split the weekly digest by project (opt-in). */
  byProject: boolean;
  /** SPEC-0008: re-anchor the trailing window at this YYYY-MM-DD date. */
  since?: string;
  /** SPEC-0020 R1: receipt template name (validated in the command handler; unknown → exit 1). */
  template?: string;
  /** SPEC-0013: distinct-session recurrence threshold for standing-rule suggestions. */
  handoffThreshold?: number;
  /** SPEC-0011 R2: CSV export mode — "session" (one row) or "tool" (row per tool). */
  csvMode?: "session" | "tool";
  /** SPEC-0015: print the exact benchmark payload without prompting or sending. */
  dryRun: boolean;
  /** SPEC-0009 R4: evaluate the budget and exit 1 if any configured cap is exceeded. */
  checkBudget: boolean;
}

/** Value-consuming flags: `--theme dark`, `-o out.svg`. Anything else is a boolean flag or positional. */
export function parseArgs(argv: string[]): ParsedArgs {
  let json = false;
  let list = false;
  let handoff = false;
  let help = false;
  let methodology = false;
  let telemetryShow = false;
  let quota = false;
  let template: string | undefined;
  let handoffThreshold: number | undefined;
  let mini = false;
  let csvMode: "session" | "tool" | undefined;
  let dryRun = false;
  let checkBudget = false;
  let byProject = false;
  let since: string | undefined;
  let svg = false;
  let png = false;
  let theme: "light" | "dark" = "light";
  let output: string | undefined;
  let post = false;
  let prSession: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--list") {
      list = true;
    } else if (arg === "--handoff") {
      handoff = true;
    } else if (arg === "--telemetry-show") {
      telemetryShow = true;
    } else if (arg === "--methodology") {
      methodology = true;
    } else if (arg === "--quota") {
      quota = true;
    } else if (arg === "--template") {
      template = argv[++i];
    } else if (arg.startsWith("--template=")) {
      template = arg.slice("--template=".length);
    } else if (arg === "--handoff-threshold") {
      handoffThreshold = Number(argv[++i]);
    } else if (arg.startsWith("--handoff-threshold=")) {
      handoffThreshold = Number(arg.slice("--handoff-threshold=".length));
    } else if (arg === "--mini") {
      mini = true;
    } else if (arg === "--csv" || arg === "--csv=session") {
      csvMode = "session";
    } else if (arg === "--csv=tool") {
      csvMode = "tool";
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--check-budget") {
      checkBudget = true;
    } else if (arg === "--by-project") {
      byProject = true;
    } else if (arg === "--since") {
      since = argv[++i];
    } else if (arg.startsWith("--since=")) {
      since = arg.slice("--since=".length);
    } else if (arg === "--post") {
      post = true;
    } else if (arg === "--session") {
      prSession = argv[++i];
    } else if (arg.startsWith("--session=")) {
      prSession = arg.slice("--session=".length);
    } else if (arg === "--svg") {
      svg = true;
    } else if (arg === "--png") {
      png = true;
    } else if (arg === "--theme") {
      theme = argv[++i] === "dark" ? "dark" : "light";
    } else if (arg === "-o" || arg === "--output") {
      output = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else {
      positional.push(arg);
    }
  }

  if (help) {
    return { command: "help", json, svg, png, theme, output, byProject, since, checkBudget, dryRun, csvMode, handoffThreshold, template };
  }

  if (methodology) {
    return { command: "methodology", json, svg, png, theme, output, byProject, since, checkBudget, dryRun, csvMode, handoffThreshold, template };
  }

  if (telemetryShow) {
    return { command: "telemetry-show", json, svg, png, theme, output, byProject, since, checkBudget, dryRun, csvMode, handoffThreshold, template };
  }

  if (checkBudget) {
    return { command: "check-budget", json, svg, png, theme, output, byProject, since, checkBudget, dryRun, csvMode, handoffThreshold, template };
  }

  if (quota) {
    return { command: "quota", json, svg, png, theme, output, byProject, since, checkBudget, dryRun, csvMode, handoffThreshold, template };
  }

  if (positional[0] === "compare") {
    return { command: "compare", compareA: positional[1], compareB: positional[2], json, svg, png, theme, output, byProject, since, checkBudget, dryRun, csvMode, handoffThreshold, template };
  }

  if (positional[0] === "benchmark") {
    return { command: "benchmark", selector: positional[1], json, svg, png, theme, output, byProject, since, dryRun } as ParsedArgs;
  }

  if (mini) {
    return { command: "mini", selector: positional[0], json, svg, png, theme, output, byProject, since, dryRun, csvMode, checkBudget, handoffThreshold, template };
  }

  if (positional[0] === "install-hook") {
    return { command: "install-hook", json, svg, png, theme, output, byProject, since, dryRun, csvMode, checkBudget, handoffThreshold, template };
  }

  if (positional[0] === "uninstall-hook") {
    return { command: "uninstall-hook", json, svg, png, theme, output, byProject, since, dryRun, csvMode, checkBudget, handoffThreshold, template };
  }

  if (positional[0] === "statusline") {
    return { command: "statusline", selector: positional[1], json, svg, png, theme, output, byProject, since, dryRun, csvMode, checkBudget } as ParsedArgs;
  }

  if (positional[0] === "templates") {
    return { command: "templates", json, svg, theme, output, byProject, since, checkBudget, dryRun, csvMode, png, handoffThreshold, template } as ParsedArgs;
  }

  if (positional[0] === "week") {
    return { command: "week", json, svg, png, theme, output, byProject, since, checkBudget, dryRun, csvMode, handoffThreshold, template };
  }

  if (positional[0] === "pr") {
    return { command: "pr", post, prSession, json, svg, theme, output, byProject, since, checkBudget, dryRun, csvMode, png, handoffThreshold, template };
  }

  if (list) {
    return { command: "list", json, svg, png, theme, output, byProject, since, checkBudget, dryRun, csvMode, handoffThreshold, template };
  }

  if (handoff) {
    return { command: "handoff", selector: positional[0], json, svg, png, theme, output, byProject, since, checkBudget, dryRun, csvMode, handoffThreshold, template };
  }

  return { command: "receipt", selector: positional[0], json, svg, png, theme, output, byProject, since, checkBudget, dryRun, csvMode, handoffThreshold, template };
}

/**
 * SPEC-0018 stable selection seam: the command an argv selects, independent of
 * how selection is implemented. Pre-refactor this wraps `parseArgs`; the command
 * registry (SPEC-0018 R1/R2) reimplements it over per-command metadata — a async
 * discovery step — without changing callers, so the R8 preservation suite proves
 * selection precedence is byte-identical across the refactor. Async because
 * registry discovery loads command modules; today's body is synchronous.
 */
export async function resolveCommand(argv: string[]): Promise<string> {
  return parseArgs(argv).command;
}
