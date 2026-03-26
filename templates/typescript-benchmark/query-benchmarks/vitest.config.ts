export default {
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 120000,
    reporters: ["default", "json"],
    outputFile: {
      json: "./reports/test-results.json",
    },
  },
};
