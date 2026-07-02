// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", ".stryker-tmp/**"] },
  ...tseslint.configs.recommended,
);
