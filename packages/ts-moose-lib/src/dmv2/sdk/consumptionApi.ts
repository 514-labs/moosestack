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
      // Check for collision with existing keys
      if (apis.has(config.path)) {
        const existing = apis.get(config.path)!;
        throw new Error(
          `Cannot register API "${name}" with custom path "${config.path}" - this path is already used by API "${existing.name}"`,
        );
      }
      // Register with just the path
      apis.set(config.path, this);

      // If versioned, also register with path/version
      if (config.version) {
        const versionedPath = `${config.path}/${config.version}`;
        if (apis.has(versionedPath)) {
          const existing = apis.get(versionedPath)!;
          throw new Error(
            `Cannot register API "${name}" with path "${versionedPath}" - this path is already used by API "${existing.name}"`,
          );
        }
        apis.set(versionedPath, this);
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
    const path = this.config?.path || this.name;
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
