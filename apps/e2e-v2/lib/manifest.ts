/**
 * Capability manifest loading and matching utilities
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type {
  CapabilityManifest,
  Template,
  Scenario,
  MatchResult,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.join(__dirname, "../../../templates");
const MANIFEST_FILENAME = "moose.capabilities.json";

/**
 * Load a capability manifest from a template directory
 */
export function loadManifest(templatePath: string): CapabilityManifest | null {
  const manifestPath = path.join(templatePath, MANIFEST_FILENAME);

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(content) as CapabilityManifest;
  } catch (error) {
    console.error(`Failed to load manifest from ${manifestPath}:`, error);
    return null;
  }
}

/**
 * Discover all templates with capability manifests.
 * If MOOSE_TEMPLATE env var is set, only returns that specific template.
 * This supports CI parallelization where each job handles one template.
 */
export function discoverTemplates(): Template[] {
  const templates: Template[] = [];
  const targetTemplate = process.env.MOOSE_TEMPLATE;

  if (!fs.existsSync(TEMPLATES_DIR)) {
    console.warn(`Templates directory not found: ${TEMPLATES_DIR}`);
    return templates;
  }

  const entries = fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    // If MOOSE_TEMPLATE is set, only process that specific template
    if (targetTemplate && entry.name !== targetTemplate) {
      continue;
    }

    const templatePath = path.join(TEMPLATES_DIR, entry.name);
    const manifest = loadManifest(templatePath);

    if (manifest) {
      templates.push({
        name: entry.name,
        path: templatePath,
        manifest,
      });
    }
  }

  return templates;
}

/**
 * Check if a capability matches a requirement
 * Supports wildcard matching (e.g., "model:*" matches "model:Foo")
 */
export function capabilityMatches(
  capability: string,
  requirement: string,
): boolean {
  // Exact match
  if (capability === requirement) return true;

  // Wildcard match: "model:*" matches any "model:X"
  if (requirement.endsWith("*")) {
    const prefix = requirement.slice(0, -1);
    return capability.startsWith(prefix);
  }

  return false;
}

/**
 * Check if a template satisfies all requirements of a scenario
 */
export function templateSatisfies(
  template: Template,
  scenario: Scenario,
): boolean {
  // Check if scenario is skipped for this template
  if (template.manifest.skipScenarios?.includes(scenario.name)) {
    return false;
  }

  // Check all requirements are satisfied
  for (const requirement of scenario.requires) {
    const satisfied = template.manifest.capabilities.some((cap) =>
      capabilityMatches(cap, requirement),
    );

    if (!satisfied) {
      return false;
    }
  }

  return true;
}

/**
 * Match scenarios to compatible templates
 */
export function matchScenarios(
  scenarios: Scenario[],
  templates: Template[],
): MatchResult[] {
  return scenarios.map((scenario) => ({
    scenario,
    matchingTemplates: templates.filter((t) => templateSatisfies(t, scenario)),
  }));
}

/**
 * Get the test port for a template (with fallback)
 */
export function getTestPort(template: Template, defaultPort = 4000): number {
  return template.manifest.testPort ?? defaultPort;
}
