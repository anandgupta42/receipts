import { describe, expect, it } from "vitest";
import { INTEGRATION_RECIPES, INTEGRATION_TARGETS, integrationRecipe } from "../../src/setup/integrations.js";
import { integrationsToJson, renderIntegrationMatrix, renderIntegrationRecipe } from "../../src/setup/render.js";

describe("SPEC-0050 integration recipes", () => {
  it("covers the day-1 targets with exact recipes", () => {
    expect(INTEGRATION_RECIPES.map((recipe) => recipe.target)).toEqual([...INTEGRATION_TARGETS]);
    for (const recipe of INTEGRATION_RECIPES) {
      expect(recipe.start).not.toHaveLength(0);
      expect(recipe.undo).not.toHaveLength(0);
      expect(recipe.network).not.toHaveLength(0);
      expect(recipe.files.length).toBeGreaterThan(0);
    }
  });

  it("keeps assistant wrappers thin CLI instructions", () => {
    for (const target of ["claude-code", "codex", "opencode", "cursor"] as const) {
      const recipe = integrationRecipe(target);
      expect(recipe).toBeDefined();
      expect(recipe?.snippet).toContain("npx aireceipts-cli");
      expect(recipe?.snippet).not.toMatch(/price table|parser|attributeByTool|buildReceiptModel/i);
    }
  });

  it("renders matrix and target recipe without inventing network behavior", () => {
    const matrix = renderIntegrationMatrix();
    expect(matrix).toContain("AIRECEIPTS INTEGRATIONS");
    expect(matrix).toContain("claude-code");
    expect(matrix).toContain("opencode");
    expect(matrix).toContain("npx aireceipts-cli integrations");

    // #192 — a value whose dotted row would leave no room for the label must
    // fall back to `Label: value`, never truncate the label to "Sta…".
    expect(matrix).not.toContain("…");
    for (const line of matrix.split("\n")) {
      if (line.trimStart().startsWith("Start")) expect(line).toMatch(/^\s+Start(\.{3,}|: )/);
    }

    const github = integrationRecipe("github");
    expect(github).toBeDefined();
    const rendered = renderIntegrationRecipe(github!);
    expect(rendered).toContain("notice-only");
    expect(rendered).toContain("CI never generates receipts");
  });

  it("emits stable JSON for future UI without local paths", () => {
    const json = integrationsToJson();
    expect(Object.keys(json)).toEqual(["schemaVersion", "targets"]);
    expect(json.targets).toHaveLength(5);
    expect(JSON.stringify(json)).not.toMatch(/\/Users|HOME|USERPROFILE/);
  });
});
