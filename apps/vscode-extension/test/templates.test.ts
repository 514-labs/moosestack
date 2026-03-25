import assert from "node:assert/strict";
import test from "node:test";

import { parseTemplateListResponse } from "../src/templates";

test("parseTemplateListResponse accepts the supported schema version", () => {
  const templates = parseTemplateListResponse(
    JSON.stringify({
      schema_version: 1,
      template_version: "0.0.1",
      templates: [
        {
          description: "TypeScript project",
          language: "typescript",
          name: "typescript",
        },
      ],
    }),
  );

  assert.equal(templates.length, 1);
  assert.equal(templates[0]?.name, "typescript");
});

test("parseTemplateListResponse rejects invalid JSON with context", () => {
  assert.throws(
    () => parseTemplateListResponse("warning: not json"),
    /Failed to parse `moose template list --json` output/,
  );
});

test("parseTemplateListResponse rejects unsupported schema versions", () => {
  assert.throws(
    () =>
      parseTemplateListResponse(
        JSON.stringify({
          schema_version: 2,
          template_version: "0.0.1",
          templates: [],
        }),
      ),
    /Unsupported Moose template JSON schema version/,
  );
});
