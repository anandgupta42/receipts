// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", ".stryker-tmp/**", ".claude/worktrees/**"] },
  ...tseslint.configs.recommended,
);
