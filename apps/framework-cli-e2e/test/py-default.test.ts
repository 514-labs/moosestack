/// <reference types="node" />
/// <reference types="mocha" />

import {
  createTemplateTestSuite,
  registerCliVersionTest,
  registerTemplateGlobalHooks,
  PYTHON_DEFAULT_TEMPLATE_CONFIG,
} from "./templates.test";

if (process.env.E2E_TEMPLATE_TARGET === "py-default") {
  registerCliVersionTest();

  describe("Moose Templates", () => {
    createTemplateTestSuite(PYTHON_DEFAULT_TEMPLATE_CONFIG);
  });

  registerTemplateGlobalHooks();
}
