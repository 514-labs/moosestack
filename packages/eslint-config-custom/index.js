// ESLint Flat Config for Next.js 16
const nextConfig = require("eslint-config-next");
const prettierConfig = require("eslint-config-prettier");
const eslintJs = require("@eslint/js");
const tseslint = require("typescript-eslint");

// Export flat config compatible with ESLint 9 and Next.js 16
module.exports = [
  // Base recommended rules
  eslintJs.configs.recommended,

  // Spread Next.js config (it's already an array of configs)
  ...nextConfig,

  // TypeScript ESLint recommended configs
  ...tseslint.configs.recommended,

  // Prettier config to disable conflicting rules
  // In flat config, we just need the rules object
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
