// ESLint Flat Config for Next.js 16
const nextConfig = require("eslint-config-next");
const turboConfigModule = require("eslint-config-turbo/flat");
const prettierConfig = require("eslint-config-prettier");
const eslintJs = require("@eslint/js");
const tseslint = require("typescript-eslint");

// Extract the actual config from the turbo module
const turboConfig = turboConfigModule.default || turboConfigModule;

// Validate that nextConfig is a flat config (array)
if (!Array.isArray(nextConfig)) {
  throw new Error(
    "eslint-config-next must export a flat config (array). Got: " +
      typeof nextConfig,
  );
}

// Validate that turboConfig is a flat config (array)
if (!Array.isArray(turboConfig)) {
  throw new Error(
    "eslint-config-turbo/flat must export a flat config (array). Got: " +
      typeof turboConfig,
  );
}

// Export flat config compatible with ESLint 9 and Next.js 16
module.exports = [
  // Base recommended rules
  eslintJs.configs.recommended,

  // Spread Next.js config (it's already an array of configs)
  ...nextConfig,

  // Spread Turbo config for Turborepo-specific rules
  ...turboConfig,

  // TypeScript ESLint recommended configs
  ...tseslint.configs.recommended,

  // Prettier config to disable conflicting rules
  // In flat config, prettier exports an object with rules, not an array
  {
    rules: prettierConfig.rules || {},
  },

  // Custom rules and overrides
  {
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      // Can mark a variable or an arg as unused by prefixing with _
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Temporarily (?) disabled
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
