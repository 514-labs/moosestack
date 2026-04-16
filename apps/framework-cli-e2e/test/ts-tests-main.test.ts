/// <reference types="node" />
/// <reference types="mocha" />

import {
  createTemplateTestSuite,
  registerCliVersionTest,
  registerTemplateGlobalHooks,
  TYPESCRIPT_TESTS_TEMPLATE_CONFIG,
} from "./templates.test";

if (process.env.E2E_TEMPLATE_TARGET === "ts-tests-main") {
  registerCliVersionTest();

  describe("Moose Templates", () => {
    createTemplateTestSuite(TYPESCRIPT_TESTS_TEMPLATE_CONFIG);
  });

  registerTemplateGlobalHooks();
}
