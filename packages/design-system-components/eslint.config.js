// ESLint Flat Config for design-system-components
const coreWebVitals = require("eslint-config-next/core-web-vitals");
const customConfig = require("@repo/eslint-config-custom");

// Merge core-web-vitals with custom config
// Custom config includes turbo rules, prettier overrides, and custom rules like _ prefix exemption
module.exports = [...customConfig];
