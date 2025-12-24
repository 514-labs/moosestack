/**
 * e2e-v2 Test Library
 *
 * Provides utilities for capability-based test matching and execution.
 */

// Type exports
export type {
  CapabilityManifest,
  Scenario,
  Template,
  TestContext,
  FixtureFile,
  FixtureData,
  FixtureVerification,
  MatchResult,
} from "./types.js";

// Manifest utilities
export {
  loadManifest,
  discoverTemplates,
  capabilityMatches,
  templateSatisfies,
  matchScenarios,
  getTestPort,
} from "./manifest.js";

// Runner utilities
export {
  waitFor,
  sleep,
  waitForMooseReady,
  startMooseDev,
  stopMoose,
  createTestContext,
  loadFixtures,
  readFixtureFile,
  queryClickHouse,
  ingestRecord,
  ingestBatch,
} from "./runner.js";
