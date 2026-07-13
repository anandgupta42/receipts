import { INTEGRATION_RECIPES, INTEGRATION_TARGETS, integrationRecipe } from "../../setup/integrations.js";
import { integrationsToJson, renderIntegrationMatrix, renderIntegrationRecipe } from "../../setup/render.js";
import type { CommandContext, CommandDef } from "../types.js";
import { setExitClass } from "../exitClass.js";

async function run(ctx: CommandContext): Promise<number> {
  const target = ctx.options.positional[1];
  if (target !== undefined) {
    const recipe = integrationRecipe(target);
    if (!recipe) {
      ctx.stderr.write(`unknown integration target "${target}" (supported: ${INTEGRATION_TARGETS.join(", ")})\n`);
      setExitClass(ctx, "invalid-arguments");
      return 1;
    }
    if (ctx.options.json) {
      ctx.stdout.write(`${JSON.stringify(integrationsToJson([recipe]), null, 2)}\n`);
    } else {
      ctx.stdout.write(`${renderIntegrationRecipe(recipe)}\n`);
    }
    return 0;
  }

  if (ctx.options.json) {
    ctx.stdout.write(`${JSON.stringify(integrationsToJson(INTEGRATION_RECIPES), null, 2)}\n`);
  } else {
    ctx.stdout.write(`${renderIntegrationMatrix(INTEGRATION_RECIPES)}\n`);
  }
  return 0;
}

export const command: CommandDef = {
  name: "integrations",
  priority: 75,
  matches: (options) => options.positional[0] === "integrations",
  run,
  help: {
    order: 16,
    lines: ["  aireceipts integrations [target] [--json]  print setup recipes for assistants and CI"],
  },
};
