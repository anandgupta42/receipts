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
  /** SPEC-0026 R5: `aireceipts pr --no-details` omits the collapsed full-receipts section. */
  readonly noDetails: boolean;
  /** SPEC-0035 R5: `aireceipts pr --post --artifact --share` prints share intent URLs to stderr. */
  readonly share: boolean;
  /** SPEC-0065 R1: `aireceipts pr --store <comment|ref>` — where the receipt is persisted; default `comment`. */
  readonly store?: "comment" | "ref";
  /** SPEC-0065 R2: `aireceipts pr --store ref --push-ref` also pushes the written ref to `origin`. */
  readonly pushRef: boolean;
  /** SPEC-0064 R2: hidden `pr-check --base-repo owner/repo` override. */
  readonly prBaseRepo?: string;
  /** SPEC-0064 R2: hidden `pr-check --head-repo owner/repo` override. */
  readonly prHeadRepo?: string;
  /** SPEC-0064 R2: hidden `pr-check --head-ref branch` override. */
  readonly prHeadRef?: string;
  /** SPEC-0064 R2: hidden `pr-check --pr <number>` override. */
  readonly prNumber?: string;
  /** SPEC-0064 R4: hidden `pr-check --require-same-repo` enforcement flag. */
  readonly requireSameRepo: boolean;
  /** SPEC-0056: `aireceipts backfill --limit N` caps the swept set to the N most recent matches. */
  readonly limit?: number;
  /** SPEC-0056: `aireceipts backfill --out <dir>` — distinct from `output` (SVG/PNG's `-o`/`--output`). */
  readonly outDir?: string;
  // Command-selecting boolean flags (consumed by the registry, not the commands):
  readonly help: boolean;
  readonly methodology: boolean;
  readonly telemetryShow: boolean;
  readonly quota: boolean;
  readonly checkBudget: boolean;
  readonly list: boolean;
  readonly handoff: boolean;
  readonly mini: boolean;
  readonly version: boolean;
  readonly demo: boolean;
  /** SPEC-0054 R4: render the opt-in DETAILS section (classic template only). */
  readonly details: boolean;
  /** SPEC-0062 R3: `aireceipts statusline --format "<segments>"` — comma-separated segment names. */
  readonly format?: string;
  /** SPEC-0075 R1: `aireceipts statusline --cwd <path>` — scope disk fallback to one cwd. */
  readonly cwd?: string;
  /** SPEC-0070 R1: `aireceipts pr --samosa` opts the tip link back onto the PR comment + artifact (off by default). */
  readonly samosa: boolean;
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
  let version = false;
  let demo = false;
  let details = false;
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
  let noDetails = false;
  let share = false;
  let store: "comment" | "ref" | undefined;
  let pushRef = false;
  let prBaseRepo: string | undefined;
  let prHeadRepo: string | undefined;
  let prHeadRef: string | undefined;
  let prNumber: string | undefined;
  let requireSameRepo = false;
  let limit: number | undefined;
  let outDir: string | undefined;
  let format: string | undefined;
  let cwd: string | undefined;
  let samosa = false;
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
    } else if (arg === "--no-details") {
      noDetails = true;
    } else if (arg === "--share") {
      share = true;
    } else if (arg === "--store") {
      const value = argv[++i];
      if (value !== "comment" && value !== "ref") {
        throw new Error(`--store must be "comment" or "ref" (got ${JSON.stringify(value)})`);
      }
      store = value;
    } else if (arg.startsWith("--store=")) {
      const value = arg.slice("--store=".length);
      if (value !== "comment" && value !== "ref") {
        throw new Error(`--store must be "comment" or "ref" (got ${JSON.stringify(value)})`);
      }
      store = value;
    } else if (arg === "--push-ref") {
      pushRef = true;
    } else if (arg === "--base-repo") {
      prBaseRepo = argv[++i];
    } else if (arg.startsWith("--base-repo=")) {
      prBaseRepo = arg.slice("--base-repo=".length);
    } else if (arg === "--head-repo") {
      prHeadRepo = argv[++i];
    } else if (arg.startsWith("--head-repo=")) {
      prHeadRepo = arg.slice("--head-repo=".length);
    } else if (arg === "--head-ref") {
      prHeadRef = argv[++i];
    } else if (arg.startsWith("--head-ref=")) {
      prHeadRef = arg.slice("--head-ref=".length);
    } else if (arg === "--pr") {
      prNumber = argv[++i];
    } else if (arg.startsWith("--pr=")) {
      prNumber = arg.slice("--pr=".length);
    } else if (arg === "--require-same-repo") {
      requireSameRepo = true;
    } else if (arg === "--session") {
      prSession = argv[++i];
    } else if (arg.startsWith("--session=")) {
      prSession = arg.slice("--session=".length);
    } else if (arg === "--limit") {
      limit = Number(argv[++i]);
    } else if (arg.startsWith("--limit=")) {
      limit = Number(arg.slice("--limit=".length));
    } else if (arg === "--out") {
      outDir = argv[++i];
    } else if (arg.startsWith("--out=")) {
      outDir = arg.slice("--out=".length);
    } else if (arg === "--format") {
      // A bare `--format` (no value) must fail fast downstream, not silently
      // fall back to the default line (SPEC-0062 R3) — normalize to "".
      format = argv[++i] ?? "";
    } else if (arg.startsWith("--format=")) {
      format = arg.slice("--format=".length);
    } else if (arg === "--cwd") {
      // A bare `--cwd` must fail fast downstream rather than silently falling
      // back to global discovery (SPEC-0075 R1) — normalize to "". A following
      // flag (`--cwd --help`) is another spelling of "no value": don't consume
      // it as the path (a path may still start with `-` via `--cwd=<path>`).
      const next = argv[i + 1];
      cwd = next !== undefined && !next.startsWith("-") ? argv[++i] : "";
    } else if (arg.startsWith("--cwd=")) {
      cwd = arg.slice("--cwd=".length);
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
    } else if (arg === "--version" || arg === "-v") {
      version = true;
    } else if (arg === "--demo") {
      demo = true;
    } else if (arg === "--details") {
      details = true;
    } else if (arg === "--samosa") {
      samosa = true;
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
    noDetails,
    share,
    store,
    pushRef,
    prBaseRepo,
    prHeadRepo,
    prHeadRef,
    prNumber,
    requireSameRepo,
    limit,
    outDir,
    help,
    methodology,
    telemetryShow,
    quota,
    checkBudget,
    list,
    handoff,
    mini,
    version,
    demo,
    details,
    format,
    cwd,
    samosa,
  };
}
