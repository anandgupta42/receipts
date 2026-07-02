// R6 CLI arg parsing — hand-rolled per project constraint (no arg-parsing
// library in devDependencies). `--list`, `--json`, `--handoff`, `--help`/`-h`
// are flags; `compare` is the one subcommand, taking two positional
// selectors; anything else positional is the session selector for the
// default receipt command. `--svg` (SPEC-0003) switches the receipt and
// `compare` commands to SVG output; `-o`/`--output` names the file and
// `--theme light|dark` picks the palette.
export interface ParsedArgs {
  command: "receipt" | "list" | "compare" | "handoff" | "help" | "methodology" | "telemetry-show" | "quota" | "week" | "check-budget";
  selector?: string;
  compareA?: string;
  compareB?: string;
  json: boolean;
  /** SPEC-0003 R1/R3: render the receipt (or comparison) as an SVG file. */
  svg: boolean;
  /** SPEC-0003: SVG palette. */
  theme: "light" | "dark";
  /** SPEC-0003: output file for `--svg` (defaults to receipt.svg / compare.svg). */
  output?: string;
  /** SPEC-0008 R4: split the weekly digest by project (opt-in). */
  byProject: boolean;
  /** SPEC-0008: re-anchor the trailing window at this YYYY-MM-DD date. */
  since?: string;
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
  let checkBudget = false;
  let byProject = false;
  let since: string | undefined;
  let svg = false;
  let theme: "light" | "dark" = "light";
  let output: string | undefined;
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
    } else if (arg === "--check-budget") {
      checkBudget = true;
    } else if (arg === "--by-project") {
      byProject = true;
    } else if (arg === "--since") {
      since = argv[++i];
    } else if (arg.startsWith("--since=")) {
      since = arg.slice("--since=".length);
    } else if (arg === "--svg") {
      svg = true;
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
    return { command: "help", json, svg, theme, output, byProject, since, checkBudget };
  }

  if (methodology) {
    return { command: "methodology", json, svg, theme, output, byProject, since, checkBudget };
  }

  if (telemetryShow) {
    return { command: "telemetry-show", json, svg, theme, output, byProject, since, checkBudget };
  }

  if (checkBudget) {
    return { command: "check-budget", json, svg, theme, output, byProject, since, checkBudget };
  }

  if (quota) {
    return { command: "quota", json, svg, theme, output, byProject, since, checkBudget };
  }

  if (positional[0] === "compare") {
    return { command: "compare", compareA: positional[1], compareB: positional[2], json, svg, theme, output, byProject, since, checkBudget };
  }

  if (positional[0] === "week") {
    return { command: "week", json, svg, theme, output, byProject, since, checkBudget };
  }

  if (list) {
    return { command: "list", json, svg, theme, output, byProject, since, checkBudget };
  }

  if (handoff) {
    return { command: "handoff", selector: positional[0], json, svg, theme, output, byProject, since, checkBudget };
  }

  return { command: "receipt", selector: positional[0], json, svg, theme, output, byProject, since, checkBudget };
}
