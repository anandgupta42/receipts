/**
 * R1 budget-file schema. `~/.aireceipts/budget.json` configures a daily
 * and/or a weekly cap; each configured period is either a USD amount or a
 * token count — never both for the same period (I2: a `$` figure and a
 * token figure are never merged into one number).
 */
export interface BudgetPeriodConfig {
  usd?: number;
  tokens?: number;
}

export interface BudgetConfig {
  daily?: BudgetPeriodConfig;
  weekly?: BudgetPeriodConfig;
}

export type BudgetPeriod = "daily" | "weekly";

/** Result of loading `budget.json`. `absent` (no file) stays silent per R1;
 * `invalid` (malformed JSON / failed validation) prints a stderr note per R5.
 * Both degrade to "no budget line" — the caller need not branch on which. */
export type BudgetLoadResult =
  | { status: "absent" }
  | { status: "invalid"; reason: string }
  | { status: "ok"; config: BudgetConfig };
