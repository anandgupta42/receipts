// R6 CLI arg parsing — hand-rolled per project constraint (no arg-parsing
// library in devDependencies). `--list`, `--json`, `--handoff`, `--help`/`-h`
// are flags; `compare` is the one subcommand, taking two positional
// selectors; anything else positional is the session selector for the
// default receipt command.
export interface ParsedArgs {
  command: "receipt" | "list" | "compare" | "handoff" | "help";
  selector?: string;
  compareA?: string;
  compareB?: string;
  json: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let json = false;
  let list = false;
  let handoff = false;
  let help = false;
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
    } else if (arg === "--list") {
      list = true;
    } else if (arg === "--handoff") {
      handoff = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else {
      positional.push(arg);
    }
  }

  if (help) {
    return { command: "help", json };
  }

  if (positional[0] === "compare") {
    return { command: "compare", compareA: positional[1], compareB: positional[2], json };
  }

  if (list) {
    return { command: "list", json };
  }

  if (handoff) {
    return { command: "handoff", selector: positional[0], json };
  }

  return { command: "receipt", selector: positional[0], json };
}
