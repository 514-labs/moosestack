import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentInitCompatibilityError,
  buildAgentInitRequest,
  inferAgentId,
  parseAgentInitResponse,
  parseAgentInitSchema,
} from "../src/agentInit";

const agentInitSchemaJson = JSON.stringify({
  fields: {
    agents: {
      items: {
        enum: ["vscode", "cursor", "kiro"],
        type: "string",
      },
      type: "array<string>",
    },
    version: {
      enum: [2, 1],
      type: "integer",
    },
  },
  input_format: "json",
  version: 1,
});

test("parseAgentInitSchema accepts the supported schema version", () => {
  const schema = parseAgentInitSchema(agentInitSchemaJson);

  assert.equal(schema.schemaVersion, 1);
  assert.equal(schema.requestVersion, 1);
  assert.deepEqual(schema.supportedAgents, ["vscode", "cursor", "kiro"]);
});

test("inferAgentId maps supported VS Code-family editors", () => {
  assert.equal(inferAgentId("Visual Studio Code", "vscode"), "vscode");
  assert.equal(inferAgentId("Cursor", "cursor"), "cursor");
  assert.equal(inferAgentId("Kiro", "kiro"), "kiro");
  assert.equal(inferAgentId("Unknown IDE", "unknown"), null);
});

test("buildAgentInitRequest keeps the request versioned and explicit", () => {
  const request = buildAgentInitRequest(
    parseAgentInitSchema(agentInitSchemaJson),
    "vscode",
  );

  assert.deepEqual(request, {
    agents: ["vscode"],
    version: 1,
    yes: true,
  });
});

test("buildAgentInitRequest rejects unsupported agent ids", () => {
  assert.throws(
    () =>
      buildAgentInitRequest(
        parseAgentInitSchema(agentInitSchemaJson),
        "windsurf",
      ),
    AgentInitCompatibilityError,
  );
});

test("parseAgentInitResponse handles empty and structured output", () => {
  assert.equal(parseAgentInitResponse(""), null);
  assert.deepEqual(
    parseAgentInitResponse(
      JSON.stringify({
        message: "Configured VS Code successfully.",
        status: "ok",
      }),
    ),
    {
      message: "Configured VS Code successfully.",
      status: "ok",
    },
  );
});

test("parseAgentInitResponse treats non-object JSON as a compatibility error", () => {
  assert.throws(
    () => parseAgentInitResponse(JSON.stringify(["not", "an", "object"])),
    AgentInitCompatibilityError,
  );
});
