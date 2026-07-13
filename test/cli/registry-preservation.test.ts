// SPEC-0018 R8 — pre-refactor preservation coverage, committed BEFORE the
// command-registry refactor so any behavior drift is visible in the refactor
// diff. Everything here targets seams that survive the refactor unchanged:
//   - `resolveCommand(argv)` — the stable selection seam (SPEC-0018 R2). Today it
//     wraps `parseArgs`; the registry reimplements it over per-command metadata.
//   - `main(argv)` end-to-end — captured stdout/stderr/exit for the no-session and
//     no-scan paths (the deterministic slice of dispatch), plus the `--help`
//     byte contract (SPEC-0018 R4) against `goldens/cli/help.txt`.
// Because this file is not edited by the refactor commit, a green run here before
// and after proves selection precedence, help bytes, and dispatch wiring held.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveCommand } from "../../src/cli/args.js";
import { main } from "../../src/cli/index.js";

const HELP_GOLDEN = resolve(dirname(fileURLToPath(import.meta.url)), "../../goldens/cli/help.txt");

interface RunResult {
  code: number;
  out: string;
  err: string;
}

/**
 * Run `main(argv)` with a captured stdout/stderr and a throwaway HOME so no real
 * transcript roots are scanned (context-safety) and the run is deterministic.
 * `seedNotice` (default true) pre-writes the first-run telemetry marker. This
 * harness also forces telemetry off, so leaving the marker absent should still
 * keep stderr silent under the kill-switch contract.
 */
async function runMain(argv: string[], seedNotice = true): Promise<RunResult> {
  const home = mkdtempSync(join(tmpdir(), "aireceipts-preserve-"));
  if (seedNotice) {
    mkdirSync(join(home, ".aireceipts"), { recursive: true });
    writeFileSync(join(home, ".aireceipts", "telemetry.json"), JSON.stringify({ shown: true }));
  }
  const saved = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    AIRECEIPTS_HOME: process.env.AIRECEIPTS_HOME,
    AIRECEIPTS_TELEMETRY: process.env.AIRECEIPTS_TELEMETRY,
  };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.AIRECEIPTS_HOME = home;
  process.env.AIRECEIPTS_TELEMETRY = "off";
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  process.stdout.write = ((c: string | Uint8Array) => {
    out += typeof c === "string" ? c : Buffer.from(c).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => {
    err += typeof c === "string" ? c : Buffer.from(c).toString("utf8");
    return true;
  }) as typeof process.stderr.write;
  try {
    const code = await main(argv);
    return { code, out, err };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

// R8 + Test matrix "R2 selectors": the full current selector → command table.
// This is the committed command inventory snapshot; the set of distinct targets
// is the 20 commands the registry must reproduce.
const SELECTION_TABLE: ReadonlyArray<readonly [string[], string]> = [
  [[], "receipt"],
  [["some-selector"], "receipt"],
  [["--list"], "list"],
  [["compare", "a", "b"], "compare"],
  [["review"], "review"],
  [["review", "abc123"], "review"],
  [["--handoff"], "review"],
  [["--handoff", "abc123"], "review"],
  [["--help"], "help"],
  [["-h"], "help"],
  [["--version"], "version"],
  [["-v"], "version"],
  [["--demo"], "demo"],
  [["--methodology"], "methodology"],
  [["--telemetry-show"], "telemetry-show"],
  [["--quota"], "quota"],
  [["week"], "week"],
  [["--check-budget"], "check-budget"],
  [["benchmark"], "benchmark"],
  [["--mini"], "mini"],
  [["install-hook"], "install-hook"],
  [["uninstall-hook"], "uninstall-hook"],
  [["statusline"], "statusline"],
  [["pr"], "pr"],
  [["stats"], "stats"],
  [["templates"], "templates"],
];

describe("SPEC-0018 R8 · command inventory snapshot (resolveCommand)", () => {
  it.each(SELECTION_TABLE)("selects %j → %s", async (argv, expected) => {
    expect(await resolveCommand(argv)).toBe(expected);
  });

  it("covers exactly the 20 current commands", () => {
    const distinct = new Set(SELECTION_TABLE.map(([, cmd]) => cmd));
    expect([...distinct].sort()).toEqual(
      [
        "benchmark",
        "check-budget",
        "compare",
        "demo",
        "help",
        "install-hook",
        "list",
        "methodology",
        "mini",
        "pr",
        "quota",
        "receipt",
        "review",
        "stats",
        "statusline",
        "telemetry-show",
        "templates",
        "uninstall-hook",
        "version",
        "week",
      ].sort(),
    );
  });
});

describe("SPEC-0018 R2 · selection precedence (byte-compatible with parseArgs)", () => {
  // help beats every other selector, including hidden info commands and subcommands.
  it("--help wins over --quota and a positional subcommand", async () => {
    expect(await resolveCommand(["--help", "--quota", "compare", "a", "b"])).toBe("help");
    expect(await resolveCommand(["--mini", "--help"])).toBe("help");
    expect(await resolveCommand(["week", "--help"])).toBe("help");
  });

  // --version sits just below --help, so --help still wins when both are passed,
  // but --version beats every other command-selecting flag.
  it("--help wins over --version; --version wins over --methodology and --quota", async () => {
    expect(await resolveCommand(["--version", "--help"])).toBe("help");
    expect(await resolveCommand(["--version", "--methodology"])).toBe("version");
    expect(await resolveCommand(["--version", "--quota"])).toBe("version");
  });

  // hidden info commands (methodology, telemetry-show) beat budget/quota/subcommands.
  it("--methodology / --telemetry-show beat check-budget, quota, and subcommands", async () => {
    expect(await resolveCommand(["--methodology", "--check-budget"])).toBe("methodology");
    expect(await resolveCommand(["--telemetry-show", "--quota", "week"])).toBe("telemetry-show");
  });

  // check-budget (flag) beats quota and subcommands; quota beats subcommands.
  it("--check-budget beats --quota; --quota beats a positional subcommand", async () => {
    expect(await resolveCommand(["--check-budget", "--quota", "compare", "a", "b"])).toBe("check-budget");
    expect(await resolveCommand(["--quota", "week"])).toBe("quota");
  });

  // compare (positional) beats --mini; --mini beats install-hook (the interleaving
  // in parseArgs: compare < mini < install-hook).
  it("compare beats --mini; --mini beats install-hook", async () => {
    expect(await resolveCommand(["--mini", "compare", "a", "b"])).toBe("compare");
    expect(await resolveCommand(["--mini", "install-hook"])).toBe("mini");
  });

  // list/handoff (flags) are below every positional subcommand; receipt is default.
  it("subcommands beat --list/--handoff; bare positional is the receipt selector", async () => {
    expect(await resolveCommand(["week", "--list"])).toBe("week");
    expect(await resolveCommand(["pr", "--handoff"])).toBe("pr");
    expect(await resolveCommand(["--list", "--handoff"])).toBe("list");
    expect(await resolveCommand(["nonsense-token"])).toBe("receipt");
  });
});

describe("SPEC-0018 R2 · shared output flags never change the selected command", () => {
  const SHARED = [
    ["--json"],
    ["--csv"],
    ["--csv=tool"],
    ["--svg"],
    ["--png"],
    ["--theme", "dark"],
    ["-o", "out.svg"],
    ["--output", "out.svg"],
    ["--template", "grocery"],
    ["--since", "2026-05-01"],
    ["--by-project"],
    ["--review-threshold", "5"],
    ["--handoff-threshold", "5"],
    ["--dry-run"],
    ["--post"],
    ["--session", "abc"],
  ] as const;

  it.each(SHARED)("receipt stays receipt with %j", async (...flags) => {
    expect(await resolveCommand([...flags])).toBe("receipt");
  });

  it("shared flags do not perturb an explicit subcommand", async () => {
    expect(await resolveCommand(["compare", "a", "b", "--svg", "-o", "x.svg"])).toBe("compare");
    expect(await resolveCommand(["week", "--json", "--by-project"])).toBe("week");
    expect(await resolveCommand(["--list", "--json"])).toBe("list");
  });
});

describe("SPEC-0018 R4 · --help is byte-identical to the golden", () => {
  it("main(['--help']) stdout matches goldens/cli/help.txt exactly", async () => {
    const golden = readFileSync(HELP_GOLDEN, "utf8");
    const { code, out, err } = await runMain(["--help"]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toBe(golden);
  });

  it("hidden commands are parseable but absent from help text", async () => {
    const golden = readFileSync(HELP_GOLDEN, "utf8");
    // parseable:
    expect(await resolveCommand(["--telemetry-show"])).toBe("telemetry-show");
    expect(await resolveCommand(["--methodology"])).toBe("methodology");
    // hidden from the curated help layout:
    expect(golden).not.toContain("--telemetry-show");
    expect(golden).not.toContain("--methodology");
  });
});

// The fast, byte-exact cases short-circuit before any session scan; the handful
// of scanning cases (marked) get a generous timeout because each walks five
// adapter roots. Routing for every command is already proven above via
// `resolveCommand`; here we pin the exact stdout/stderr/exit each command path
// produces, which the registry dispatch must reproduce.
const SCAN_TIMEOUT = 30_000;

describe("SPEC-0018 R8 · dispatch behavior (byte-exact, no scan)", () => {
  it("compare with one selector → usage error before any scan, exit 1", async () => {
    const { code, out, err } = await runMain(["compare", "1"]);
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toBe("compare requires two selectors: aireceipts compare <a> <b>\n");
  });

  it("compare --csv=tool → rejected (session-only) before scan, exit 1", async () => {
    const { code, out, err } = await runMain(["compare", "1", "2", "--csv=tool"]);
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toBe('compare supports --csv=session only (got "tool")\n');
  });

  it("--template with an unknown name → validation error, exit 1", async () => {
    const { code, out, err } = await runMain(["--template", "fancy"]);
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toBe('unknown template "fancy" — valid: classic, grocery, datavis\n');
  });

  it("--check-budget with no budget.json → silent, exit 0", async () => {
    const { code, out, err } = await runMain(["--check-budget"]);
    expect(code).toBe(0);
    expect(out).toBe("");
    expect(err).toBe("");
  });

  it("--methodology → attribution text on stdout, exit 0", async () => {
    const { code, out, err } = await runMain(["--methodology"]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out.length).toBeGreaterThan(0);
  });

  it("--version → prints the package.json version + newline, exit 0", async () => {
    const { code, out, err } = await runMain(["--version"]);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toMatch(/^\d+\.\d+\.\d+.*\n$/);
  });

  it("templates → live previews of every template, exit 0", async () => {
    const { code, out } = await runMain(["templates"]);
    expect(code).toBe(0);
    expect(out).toContain("classic");
    expect(out).toContain("(default)");
    expect(out).toContain("grocery");
    expect(out).toContain("datavis");
  });
});

describe("SPEC-0018 R8 · dispatch behavior (session-scanning path)", () => {
  // Session roots are captured from `homedir()` when the adapter singletons load,
  // so a per-test HOME override cannot redirect them in-process — no-session
  // stdout/stderr through `main()` is therefore not deterministic here (it depends
  // on the developer's real transcripts). Routing for the scanning commands is
  // proven above via `resolveCommand`; the byte behavior of their no-session paths
  // is covered at the unit layer (statusline.test.ts, quota.test.ts). What we can
  // pin robustly through `main()` is the `--mini` fail-safe: it must exit 0
  // whether or not sessions exist, because it runs from the SessionEnd hook.
  it(
    "--mini exits 0 (fail-safe) — never blocks the hook, session or not",
    async () => {
      const { code } = await runMain(["--mini"]);
      expect(code).toBe(0);
    },
    SCAN_TIMEOUT,
  );
});

describe("SPEC-0018 R6 · telemetry lifecycle (observable contract)", () => {
  it("--telemetry-show prints the payload, skips the first-run notice, exit 0", async () => {
    // seedNotice=false keeps the marker absent; telemetry-show must still stay silent.
    const { code, out, err } = await runMain(["--telemetry-show"], false);
    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toBe('{\n  "enabled": false,\n  "events": []\n}\n');
  });

  it("a normal command stays silent when the first run happens with telemetry disabled", async () => {
    const { code, err } = await runMain(["--check-budget"], false);
    expect(code).toBe(0);
    expect(err).toBe("");
  });
});
