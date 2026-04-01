import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./packages/web-app/src", import.meta.url)),
  "agent-contracts": fileURLToPath(
    new URL("./packages/agent-contracts/src/index.ts", import.meta.url),
  ),
  "agent-observability-langfuse": fileURLToPath(
    new URL("./packages/agent-observability-langfuse/src/index.ts", import.meta.url),
  ),
  "agent-runtime": fileURLToPath(new URL("./packages/agent-runtime/src/index.ts", import.meta.url)),
};

const exclude = ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/.moose/**"];

export default defineConfig({
  resolve: {
    alias,
  },
  test: {
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/**/test/**/*.unit.test.ts"],
          exclude,
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["packages/**/test/**/*.integration.test.ts"],
          exclude,
        },
      },
    ],
  },
});
