import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInstallStateSummary,
  createInitialInstallState,
  recordInstallAttempt,
  recordInstallFailure,
  recordInstallSuccess,
  recordUnsupportedPlatform,
  shouldShowHarnessSplash,
} from "../src/status";

test("recordInstallSuccess captures versions and clears failure state", () => {
  const state = recordInstallSuccess(
    createInitialInstallState("linux"),
    {
      cli514Version: "514 1.0.0",
      mooseVersion: "moose 2.0.0",
    },
    {
      now: "2026-03-29T12:00:00.000Z",
      platform: "linux",
    },
  );

  assert.equal(state.lastResult, "success");
  assert.equal(state.lastSuccessAt, "2026-03-29T12:00:00.000Z");
  assert.equal(state.lastFailureMessage, null);
  assert.equal(state.cli514Version, "514 1.0.0");
  assert.equal(state.mooseVersion, "moose 2.0.0");
});

test("buildInstallStateSummary returns a readable installer status block", () => {
  const state = recordInstallSuccess(
    recordInstallAttempt(createInitialInstallState("linux"), {
      now: "2026-03-29T11:59:00.000Z",
      platform: "linux",
    }),
    {
      cli514Version: "514 1.0.0",
      mooseVersion: "moose 2.0.0",
    },
    {
      now: "2026-03-29T12:00:00.000Z",
      platform: "linux",
    },
  );

  const summary = buildInstallStateSummary(state);

  assert.match(summary, /Platform: linux/);
  assert.match(summary, /Last result: latest installer run succeeded/);
  assert.match(summary, /Moose CLI: moose 2\.0\.0/);
  assert.match(summary, /514 CLI: 514 1\.0\.0/);
  assert.match(summary, /Harness init command: moose init/);
});

test("recordUnsupportedPlatform preserves the WSL guidance", () => {
  const state = recordUnsupportedPlatform(
    createInitialInstallState("win32"),
    undefined,
    {
      now: "2026-03-29T12:00:00.000Z",
      platform: "win32",
    },
  );

  const summary = buildInstallStateSummary(state);

  assert.equal(state.lastResult, "unsupported-platform");
  assert.match(summary, /Windows via WSL only/);
  assert.match(summary, /WSL/);
});

test("recordInstallFailure keeps the failure message for later inspection", () => {
  const state = recordInstallFailure(
    createInitialInstallState("darwin"),
    "curl failed",
    {
      now: "2026-03-29T12:00:00.000Z",
      platform: "darwin",
    },
  );

  assert.equal(state.lastResult, "failure");
  assert.equal(state.lastFailureMessage, "curl failed");
});

test("shouldShowHarnessSplash only opens after the first success in a session", () => {
  const successfulState = recordInstallSuccess(
    createInitialInstallState("linux"),
    {
      cli514Version: "514 1.0.0",
      mooseVersion: "moose 2.0.0",
    },
    {
      now: "2026-03-29T12:00:00.000Z",
      platform: "linux",
    },
  );

  assert.equal(shouldShowHarnessSplash(successfulState, false), true);
  assert.equal(shouldShowHarnessSplash(successfulState, true), false);
  assert.equal(
    shouldShowHarnessSplash(createInitialInstallState("linux"), false),
    false,
  );
});
