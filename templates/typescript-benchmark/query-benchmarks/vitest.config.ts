import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

dotenv.config({ path: "./.env.preview" });

export default defineConfig({
  test: {
    environment: "node",
    env: process.env,
    include: ["tests/**/*.test.ts"],
    testTimeout: 120000,
    reporters: ["default", "json"],
    outputFile: {
      json: "./reports/test-results.json",
    },
  },
});
