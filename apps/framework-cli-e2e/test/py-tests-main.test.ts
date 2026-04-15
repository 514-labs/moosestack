/// <reference types="node" />
/// <reference types="mocha" />

import {
  createTemplateTestSuite,
  registerCliVersionTest,
  registerTemplateGlobalHooks,
  PYTHON_TESTS_TEMPLATE_CONFIG,
} from "./templates.test";

if (process.env.E2E_TEMPLATE_TARGET === "py-tests-main") {
  registerCliVersionTest();

  describe("Moose Templates", () => {
    createTemplateTestSuite(PYTHON_TESTS_TEMPLATE_CONFIG);
  });

  registerTemplateGlobalHooks();
}
