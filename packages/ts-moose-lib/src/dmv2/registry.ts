/**
 * @module registry
 * Public registry functions for accessing Moose Data Model v2 (dmv2) resources.
 *
 * This module provides functions to retrieve registered resources like tables, streams,
 * APIs, and more. These functions are part of the public API and can be used by
 * user applications to inspect and interact with registered Moose resources.
 */

import { OlapTable } from "./sdk/olapTable";
import { Stream } from "./sdk/stream";
import { IngestApi } from "./sdk/ingestApi";
import { Api } from "./sdk/consumptionApi";
import { SqlResource } from "./sdk/sqlResource";
import { Workflow } from "./sdk/workflow";
import { WebApp } from "./sdk/webApp";
import { getMooseInternal } from "./internal";

/**
 * Get all registered OLAP tables.
 * @returns A Map of table name to OlapTable instance
 */
export function getTables(): Map<string, OlapTable<any>> {
  return getMooseInternal().tables;
}

/**
 * Get a registered OLAP table by name.
 * @param name - The name of the table
 * @returns The OlapTable instance or undefined if not found
 */
export function getTable(name: string): OlapTable<any> | undefined {
  return getMooseInternal().tables.get(name);
}

/**
 * Get all registered streams.
 * @returns A Map of stream name to Stream instance
 */
export function getStreams(): Map<string, Stream<any>> {
  return getMooseInternal().streams;
}

/**
 * Get a registered stream by name.
 * @param name - The name of the stream
 * @returns The Stream instance or undefined if not found
 */
export function getStream(name: string): Stream<any> | undefined {
  return getMooseInternal().streams.get(name);
}

/**
 * Get all registered ingestion APIs.
 * @returns A Map of API name to IngestApi instance
 */
export function getIngestApis(): Map<string, IngestApi<any>> {
  return getMooseInternal().ingestApis;
}

/**
 * Get a registered ingestion API by name.
 * @param name - The name of the ingestion API
 * @returns The IngestApi instance or undefined if not found
 */
export function getIngestApi(name: string): IngestApi<any> | undefined {
  return getMooseInternal().ingestApis.get(name);
}

/**
 * Get all registered APIs (consumption/egress APIs).
 * @returns A Map of API key to Api instance
 */
export function getApis(): Map<string, Api<any>> {
  return getMooseInternal().apis;
}

/**
 * Get a registered API by name, version, or path.
 *
 * Supports multiple lookup strategies:
 * 1. Direct lookup by full key (name:version or name for unversioned)
 * 2. Lookup by name with automatic version aliasing when only one versioned API exists
 * 3. Lookup by custom path (if configured)
 *
 * @param nameOrPath - The name, name:version, or custom path of the API
 * @returns The Api instance or undefined if not found
 */
export function getApi(nameOrPath: string): Api<any> | undefined {
  const registry = getMooseInternal();

  // Try direct lookup first (full key: name or name:version)
  const directMatch = registry.apis.get(nameOrPath);
  if (directMatch) {
    return directMatch;
  }

  // Build alias maps on-demand for unversioned lookups
  const versionedApis = new Map<string, Api<any>[]>();
  const pathMap = new Map<string, Api<any>>();

  registry.apis.forEach((api, key) => {
    // Track APIs by base name for aliasing
    const baseName = api.name;
    if (!versionedApis.has(baseName)) {
      versionedApis.set(baseName, []);
    }
    versionedApis.get(baseName)!.push(api);

    // Track APIs by custom path
    if (api.config.path) {
      pathMap.set(api.config.path, api);
    }
  });

  // Try alias lookup: if there's exactly one API with this base name, return it
  const candidates = versionedApis.get(nameOrPath);
  if (candidates && candidates.length === 1) {
    return candidates[0];
  }

  // Try path-based lookup
  return pathMap.get(nameOrPath);
}

/**
 * Get all registered SQL resources.
 * @returns A Map of resource name to SqlResource instance
 */
export function getSqlResources(): Map<string, SqlResource> {
  return getMooseInternal().sqlResources;
}

/**
 * Get a registered SQL resource by name.
 * @param name - The name of the SQL resource
 * @returns The SqlResource instance or undefined if not found
 */
export function getSqlResource(name: string): SqlResource | undefined {
  return getMooseInternal().sqlResources.get(name);
}

/**
 * Get all registered workflows.
 * @returns A Map of workflow name to Workflow instance
 */
export function getWorkflows(): Map<string, Workflow> {
  return getMooseInternal().workflows;
}

/**
 * Get a registered workflow by name.
 * @param name - The name of the workflow
 * @returns The Workflow instance or undefined if not found
 */
export function getWorkflow(name: string): Workflow | undefined {
  return getMooseInternal().workflows.get(name);
}

/**
 * Get all registered web apps.
 * @returns A Map of web app name to WebApp instance
 */
export function getWebApps(): Map<string, WebApp> {
  return getMooseInternal().webApps;
}

/**
 * Get a registered web app by name.
 * @param name - The name of the web app
 * @returns The WebApp instance or undefined if not found
 */
export function getWebApp(name: string): WebApp | undefined {
  return getMooseInternal().webApps.get(name);
}
