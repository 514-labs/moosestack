// ESLint Flat Config for framework-docs-v2
const customConfig = require("@repo/eslint-config-custom");

module.exports = [
  // Spread the custom config (it's already an array)
  ...customConfig,
];
