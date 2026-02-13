// ESLint Flat Config for the workspace
const customConfig = require("@repo/eslint-config-custom");

module.exports = [
  // Spread the custom config (it's already an array)
  ...customConfig,

  // Workspace-specific settings
  {
    settings: {
      next: {
        rootDir: ["apps/*/"],
      },
    },
  },
];
