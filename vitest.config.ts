import { defineConfig } from "vitest/config";

const [maj = 0, min = 0] = process.versions.node.split(".").map(Number);
const hasNodeSqlite = maj > 22 || (maj === 22 && min >= 5);

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    pool: "forks",
    poolOptions: {
      forks: { execArgv: hasNodeSqlite ? ["--experimental-sqlite"] : [] },
    },
  },
});
