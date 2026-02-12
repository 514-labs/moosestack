// ESLint Flat Config for design-system-components
const coreWebVitals = require("eslint-config-next/core-web-vitals");
const customConfig = require("@repo/eslint-config-custom");

// Merge custom config first, then core-web-vitals
// This ensures core-web-vitals stricter rules are not overwritten by the base next config in customConfig
// Custom config includes turbo rules, prettier overrides, and custom rules like _ prefix exemption
module.exports = [...customConfig, ...coreWebVitals];
