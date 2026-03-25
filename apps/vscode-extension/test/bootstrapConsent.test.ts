import assert from "node:assert/strict";
import test from "node:test";

import {
  getAutomaticBootstrapConsentStateKey,
  withRecordedAutomaticBootstrapConsent,
} from "../src/bootstrapConsent";

test("getAutomaticBootstrapConsentStateKey normalizes workspace roots", () => {
  assert.equal(
    getAutomaticBootstrapConsentStateKey("/repo/../repo/project"),
    getAutomaticBootstrapConsentStateKey("/repo/project"),
  );
});

test("withRecordedAutomaticBootstrapConsent records consent before manual setup runs", async () => {
  const workspaceRoot = "/repo/project";
  const events: string[] = [];

  const result = await withRecordedAutomaticBootstrapConsent(
    workspaceRoot,
    async (stateKey, approved) => {
      events.push(`consent:${stateKey}:${String(approved)}`);
    },
    async () => {
      events.push("run");
      return "ok";
    },
  );

  assert.equal(result, "ok");
  assert.deepEqual(events, [
    `consent:${getAutomaticBootstrapConsentStateKey(workspaceRoot)}:true`,
    "run",
  ]);
});

test("withRecordedAutomaticBootstrapConsent preserves consent when setup fails", async () => {
  const workspaceRoot = "/repo/project";
  const events: string[] = [];

  await assert.rejects(
    withRecordedAutomaticBootstrapConsent(
      workspaceRoot,
      async (stateKey, approved) => {
        events.push(`consent:${stateKey}:${String(approved)}`);
      },
      async () => {
        events.push("run");
        throw new Error("setup failed");
      },
    ),
    /setup failed/,
  );

  assert.deepEqual(events, [
    `consent:${getAutomaticBootstrapConsentStateKey(workspaceRoot)}:true`,
    "run",
  ]);
});

test("withRecordedAutomaticBootstrapConsent skips updates without a workspace root", async () => {
  const events: string[] = [];

  await withRecordedAutomaticBootstrapConsent(
    null,
    async () => {
      events.push("consent");
    },
    async () => {
      events.push("run");
    },
  );

  assert.deepEqual(events, ["run"]);
});
