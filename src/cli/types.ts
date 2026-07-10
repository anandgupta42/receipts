// SPEC-0018 R3: command modules run through an explicit context instead of
// reaching through process globals, so each command is unit-testable by
// injecting fakes for stdin/stdout/env/clock/fs/prompt. Domain logic (session
// resolution, receipt building, rendering) is still imported directly by each
// command (R7 — shared helpers under common ownership); the context is only the
// side-effecting seams.
import type { CliOptions } from "./options.js";
import type {
  RecordExportGeneratedInput,
  RecordHookConfiguredInput,
  RecordIntegrationSurfaceRenderedInput,
  RecordPrFlowCompletedInput,
  RecordReceiptGeneratedInput,
} from "../telemetry/index.js";
import type { MilestoneValue } from "../telemetry/schemas.js";

/** A one-invocation stdin/stdout/stderr trio; process streams in production, fakes in tests. */
export interface CommandContext {
  /** The parsed flag/option bag for this invocation. */
  readonly options: CliOptions;
  readonly stdin: NodeJS.ReadStream;
  readonly stdout: NodeJS.WriteStream;
  readonly stderr: NodeJS.WriteStream;
  readonly env: NodeJS.ProcessEnv;
  /** Current working directory (injectable for tests). */
  cwd(): string;
  /** Wall clock in ms (injectable so window/budget math is deterministic in tests). */
  now(): number;
  /** Minimal filesystem seam — only the SVG/PNG write path needs it. */
  readonly fs: {
    writeFile(path: string, data: string | Uint8Array): Promise<void>;
  };
  /** A single `[y/N]` confirmation read from `stdin` (hook install, and any new command). */
  prompt(question: string): Promise<boolean>;
  /** Telemetry surface a command may read (recording/flush stays in `main()` — R6). */
  readonly telemetry: {
    showPayload(env: NodeJS.ProcessEnv): { enabled: boolean; events: readonly unknown[] };
    noteReceiptGenerated(input: Omit<RecordReceiptGeneratedInput, "receiptOrdinal">, command?: string): Promise<void>;
    recordExportGenerated(input: RecordExportGeneratedInput): void;
    recordPrFlowCompleted(input: RecordPrFlowCompletedInput): void;
    recordHookConfigured(input: RecordHookConfiguredInput): void;
    recordIntegrationSurfaceRendered(input: RecordIntegrationSurfaceRenderedInput): void;
    noteMilestone(milestone: MilestoneValue, command: string): Promise<void>;
  };
  /** The assembled `--help` text (registry-driven), for the help command. */
  renderHelp(): string;
}

/** SPEC-0018 R4: one contiguous block of `--help` Usage lines, placed by `order`. */
export interface HelpEntry {
  /** Ascending sort key across all commands + the shared output-mode lines. */
  readonly order: number;
  /** Literal Usage lines, byte-exact. */
  readonly lines: readonly string[];
}

/**
 * SPEC-0018 R1/R2: one self-contained CLI command. Discovered from its own file
 * in `src/cli/commands/` (no shared registry edit). `matches` + `priority`
 * encode selection precedence; `run` executes through the context; `help`
 * contributes this command's Usage block (omit for hidden commands).
 */
export interface CommandDef {
  readonly name: string;
  /** Higher `priority` is checked first; the first `matches` hit wins. receipt = 0 (default). */
  readonly priority: number;
  matches(options: CliOptions): boolean;
  /** SPEC-0075 R6 — invocation-level network flush policy; local recording still runs. */
  shouldFlushTelemetry?(options: CliOptions): boolean;
  run(ctx: CommandContext): number | Promise<number>;
  readonly help?: HelpEntry;
}
