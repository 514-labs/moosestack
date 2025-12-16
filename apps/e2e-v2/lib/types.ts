/**
 * Core type definitions for e2e-v2 test framework
 */

/**
 * Capability manifest for a template
 */
export interface CapabilityManifest {
  $schema?: string;
  capabilities: string[];
  testPort?: number;
  skipScenarios?: string[];
}

/**
 * Scenario definition
 */
export interface Scenario {
  name: string;
  description: string;
  requires: string[];
}

/**
 * Template with its manifest
 */
export interface Template {
  name: string;
  path: string;
  manifest: CapabilityManifest;
}

/**
 * Test context passed to scenario tests
 */
export interface TestContext {
  template: Template;
  port: number;
  baseUrl: string;
  mooseBinary: string;
}

/**
 * Fixture file format
 */
export interface FixtureFile {
  name: string;
  description?: string;
  data: FixtureData[];
  verify?: FixtureVerification;
}

export interface FixtureData {
  target: string;
  records: Record<string, unknown>[];
}

export interface FixtureVerification {
  table: string;
  minRows: number;
}

/**
 * Result of matching scenarios to templates
 */
export interface MatchResult {
  scenario: Scenario;
  matchingTemplates: Template[];
}
