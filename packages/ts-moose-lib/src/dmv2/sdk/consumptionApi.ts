import { IJsonSchemaCollection } from "typia";
import { TypedBase } from "../typedBase";
import { Column } from "../../dataModels/dataModelTypes";
import { getMooseInternal } from "../internal";
import type { ApiUtil } from "../../consumption-apis/helpers";

/**
 * Defines the signature for a handler function used by a Consumption API.
 * @template T The expected type of the request parameters or query parameters.
 * @template R The expected type of the response data.
 * @param params An object containing the validated request parameters, matching the structure of T.
 * @param utils Utility functions provided to the handler, e.g., for database access (`runSql`).
 * @returns A Promise resolving to the response data of type R.
 */
type ApiHandler<T, R> = (params: T, utils: ApiUtil) => Promise<R>;

/**
 * @template T The data type of the request parameters.
 */
export interface ApiConfig<T> {
  /**
   * An optional version string for this configuration.
   */
  version?: string;
  /**
   * An optional custom path for the API endpoint.
   * If not specified, defaults to the API name.
   */
  path?: string;
  metadata?: { description?: string };
}

/**
 * Represents a Consumption API endpoint (API), used for querying data from a Moose system.
 * Exposes data, often from an OlapTable or derived through a custom handler function.
 *
 * @template T The data type defining the expected structure of the API's query parameters.
 * @template R The data type defining the expected structure of the API's response body. Defaults to `any`.
 */
export class Api<T, R = any> extends TypedBase<T, ApiConfig<T>> {
  /** @internal The handler function that processes requests and generates responses. */
  _handler: ApiHandler<T, R>;
  /** @internal The JSON schema definition for the response type R. */
  responseSchema: IJsonSchemaCollection.IV3_1;

  /**
   * Creates a new Api instance.
   * @param name The name of the consumption API endpoint.
   * @param handler The function to execute when the endpoint is called. It receives validated query parameters and utility functions.
   * @param config Optional configuration for the consumption API.
   */
  constructor(name: string, handler: ApiHandler<T, R>, config?: {});

  /** @internal **/
  constructor(
    name: string,
    handler: ApiHandler<T, R>,
    config: ApiConfig<T>,
    schema: IJsonSchemaCollection.IV3_1,
    columns: Column[],
    responseSchema: IJsonSchemaCollection.IV3_1,
  );

  constructor(
    name: string,
    handler: ApiHandler<T, R>,
    config?: ApiConfig<T>,
    schema?: IJsonSchemaCollection.IV3_1,
    columns?: Column[],
    responseSchema?: IJsonSchemaCollection.IV3_1,
  ) {
    super(name, config ?? {}, schema, columns);
    this._handler = handler;
    this.responseSchema = responseSchema ?? {
      version: "3.1",
      schemas: [{ type: "array", items: { type: "object" } }],
      components: { schemas: {} },
    };
    const apis = getMooseInternal().apis;
    const key = `${name}${config?.version ? `:${config.version}` : ""}`;
    if (apis.has(key)) {
      throw new Error(
        `Consumption API with name ${name} and version ${config?.version} already exists`,
      );
    }
    apis.set(key, this);

    // Also register by custom path if provided
    if (config?.path) {
      if (config.version) {
        // Check if the path already ends with the version
        const pathEndsWithVersion =
          config.path.endsWith(`/${config.version}`) ||
          config.path === config.version ||
          (config.path.endsWith(config.version) &&
            config.path.length > config.version.length &&
            config.path[config.path.length - config.version.length - 1] ===
              "/");

        if (pathEndsWithVersion) {
          // Path already contains version, register as-is
          if (apis.has(config.path)) {
            const existing = apis.get(config.path)!;
            throw new Error(
              `Cannot register API "${name}" with path "${config.path}" - this path is already used by API "${existing.name}"`,
            );
          }
          apis.set(config.path, this);
        } else {
          // Path doesn't contain version, register with version appended
          const versionedPath = `${config.path.replace(/\/$/, "")}/${config.version}`;

          // Check for collision on versioned path
          if (apis.has(versionedPath)) {
            const existing = apis.get(versionedPath)!;
            throw new Error(
              `Cannot register API "${name}" with path "${versionedPath}" - this path is already used by API "${existing.name}"`,
            );
          }
          apis.set(versionedPath, this);

          // Also register the unversioned path if not already claimed
          // (This is intentionally more permissive - first API gets the unversioned path)
          if (!apis.has(config.path)) {
            apis.set(config.path, this);
          }
        }
      } else {
        // Unversioned API, check for collision and register
        if (apis.has(config.path)) {
          const existing = apis.get(config.path)!;
          throw new Error(
            `Cannot register API "${name}" with custom path "${config.path}" - this path is already used by API "${existing.name}"`,
          );
        }
        apis.set(config.path, this);
      }
    }
  }

  /**
   * Retrieves the handler function associated with this Consumption API.
   * @returns The handler function.
   */
  getHandler = (): ApiHandler<T, R> => {
    return this._handler;
  };

  async call(baseUrl: string, queryParams: T): Promise<R> {
    // Construct the API endpoint URL using custom path or default to name
    let path: string;
    if (this.config?.path) {
      // Check if the custom path already contains the version
      if (this.config.version) {
        const pathEndsWithVersion =
          this.config.path.endsWith(`/${this.config.version}`) ||
          this.config.path === this.config.version ||
          (this.config.path.endsWith(this.config.version) &&
            this.config.path.length > this.config.version.length &&
            this.config.path[
              this.config.path.length - this.config.version.length - 1
            ] === "/");

        if (pathEndsWithVersion) {
          path = this.config.path;
        } else {
          path = `${this.config.path.replace(/\/$/, "")}/${this.config.version}`;
        }
      } else {
        path = this.config.path;
      }
    } else {
      // Default to name with optional version
      path =
        this.config?.version ?
          `${this.name}/${this.config.version}`
        : this.name;
    }
    const url = new URL(`${baseUrl.replace(/\/$/, "")}/api/${path}`);

    const searchParams = url.searchParams;

    for (const [key, value] of Object.entries(queryParams as any)) {
      if (Array.isArray(value)) {
        // For array values, add each item as a separate query param
        for (const item of value) {
          if (item !== null && item !== undefined) {
            searchParams.append(key, String(item));
          }
        }
      } else if (value !== null && value !== undefined) {
        searchParams.append(key, String(value));
      }
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data as R;
  }
}

/** @deprecated Use ApiConfig<T> directly instead. */
export type EgressConfig<T> = ApiConfig<T>;

/** @deprecated Use Api directly instead. */
export const ConsumptionApi = Api;
