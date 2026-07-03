// SPEC-0018: `pr` — attach the building session's receipt to the current PR
// (SPEC-0019). priority 60, matches the `pr` positional subcommand. `--post`
// upserts via gh; without it, a dry run prints the body.
import { runPr } from "../../pr/index.js";
import type { CommandContext, CommandDef } from "../types.js";

function run(ctx: CommandContext): Promise<number> {
  return runPr({ post: ctx.options.post, session: ctx.options.prSession, artifact: ctx.options.artifact });
}

export const command: CommandDef = {
  name: "pr",
  priority: 60,
  matches: (options) => options.positional[0] === "pr",
  run,
  help: {
    order: 100,
    lines: [
      "  aireceipts pr [--post] [--session <id>] [--artifact]",
      "                                        attach the building session's receipt to",
      "                                         the current PR (dry-run prints the body;",
      "                                         --post upserts it via gh; --artifact also",
      "                                         publishes pr-<n>.html to the",
      "                                         aireceipts/artifacts branch and links it)",
    ],
  },
};
