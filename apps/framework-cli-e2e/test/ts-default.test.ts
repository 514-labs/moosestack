/// <reference types="node" />
/// <reference types="mocha" />

import {
  createTemplateTestSuite,
  registerCliVersionTest,
  registerTemplateGlobalHooks,
  TYPESCRIPT_DEFAULT_TEMPLATE_CONFIG,
} from "./templates.test";

if (process.env.E2E_TEMPLATE_TARGET === "ts-default") {
  registerCliVersionTest();

  describe("Moose Templates", () => {
    createTemplateTestSuite(TYPESCRIPT_DEFAULT_TEMPLATE_CONFIG);
  });

  registerTemplateGlobalHooks();
}
