// SPEC-0018 R2: shared argv parsing, decoupled from command selection. This is
// the flag/positional half of the old `parseArgs` verbatim — the exact same
// value-consuming and boolean flags, in the same order — but it stops at the
// parsed bag and does NOT decide the command. Selection is the registry's job
// (see `selectCommand`), so adding a positional subcommand never edits this file.
// Commands read the fields they need (a command ignoring a field is the same
// observable behavior the old per-command `ParsedArgs` returns had).

/** The parsed flag/option bag for one invocation. Command-independent. */
export interface CliOptions {
  /** Leftover positionals in argv order (e.g. `["compare", "a", "b"]`). */
  readonly positional: string[];
  readonly json: boolean;
  /** SPEC-0003: render the receipt/comparison as SVG. */
  readonly svg: boolean;
  /** SPEC-0012: rasterize the receipt SVG to PNG (receipt only). */
  readonly png: boolean;
  /** SPEC-0003: SVG/PNG palette. */
  readonly theme: "light" | "dark";
  /** SPEC-0003: output file for `--svg`/`--png`. */
  readonly output?: string;
  /** SPEC-0011 R2: CSV export mode. */
  readonly csvMode?: "session" | "tool";
  /** SPEC-0008: re-anchor the trailing window at this YYYY-MM-DD date. */
  readonly since?: string;
  /** SPEC-0008 R4: split the weekly digest by project. */
  readonly byProject: boolean;
  /** SPEC-0020 R1: receipt template name (validated by the command). */
  readonly template?: string;
  /** SPEC-0013: distinct-session recurrence threshold for standing-rule suggestions. */
  readonly handoffThreshold?: number;
  /** SPEC-0015: print the exact benchmark payload without prompting or sending. */
  readonly dryRun: boolean;
  /** SPEC-0019: `aireceipts pr --post` posts the receipt comment. */
  readonly post: boolean;
  /** SPEC-0019: `aireceipts pr --session <id>`. */
  readonly prSession?: string;
  /** SPEC-0027: `aireceipts pr --post --artifact` publishes the HTML receipt artifact. */
  readonly artifact: boolean;
  // Command-selecting boolean flags (consumed by the registry, not the commands):
  readonly help: boolean;
  readonly methodology: boolean;
  readonly telemetryShow: boolean;
  readonly quota: boolean;
  readonly checkBudget: boolean;
  readonly list: boolean;
  readonly handoff: boolean;
  readonly mini: boolean;
}

/** Value-consuming flags: `--theme dark`, `-o out.svg`. Anything else is a boolean flag or positional. */
export function parseOptions(argv: string[]): CliOptions {
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
  let artifact = false;
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
    } else if (arg === "--artifact") {
      artifact = true;
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

  return {
    positional,
    json,
    svg,
    png,
    theme,
    output,
    csvMode,
    since,
    byProject,
    template,
    handoffThreshold,
    dryRun,
    post,
    prSession,
    artifact,
    help,
    methodology,
    telemetryShow,
    quota,
    checkBudget,
    list,
    handoff,
    mini,
  };
}
