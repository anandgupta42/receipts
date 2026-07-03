// SPEC-0018: `--check-budget` — exit 1 if the configured budget cap is exceeded
// (advisory). priority 160 (above quota and every subcommand), matches the flag.
import { evaluateBudget } from "../../budget/index.js";
import type { CommandContext, CommandDef } from "../types.js";

async function run(ctx: CommandContext): Promise<number> {
  const budget = await evaluateBudget(ctx.now());
  if (budget.status === "invalid") {
    ctx.stderr.write(`budget.json ignored: ${budget.invalidReason}\n`);
    return 0;
  }
  if (budget.status === "absent") {
    return 0;
  }
  for (const line of budget.lines) {
    ctx.stdout.write(`${line}\n`);
  }
  return budget.exceeded ? 1 : 0;
}

export const command: CommandDef = {
  name: "check-budget",
  priority: 160,
  matches: (options) => options.checkBudget,
  run,
  help: {
    order: 110,
    lines: [
      "  aireceipts --check-budget             exit 1 if ~/.aireceipts/budget.json's cap is",
      "                                         exceeded (advisory; see docs)",
    ],
  },
};
