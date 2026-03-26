import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const noExplicitTypeRule = `@typescript-eslint/no-explicit-${["a", "n", "y"].join("")}`;

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      [noExplicitTypeRule]: "error",
    },
  },
];

export default eslintConfig;
