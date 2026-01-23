/**
 * Mock OTLP gRPC Logs Receiver
 *
 * A lightweight mock implementation of the OTLP LogsService gRPC endpoint
 * for testing structured logging export from moose.
 *
 * This server collects all received log records and provides methods to
 * query and filter them for test assertions.
 */

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as path from "path";
import { logger } from "./logger";

const testLogger = logger.scope("otlp-mock-server");

/**
 * Represents a key-value pair in OTLP format
 */
interface OtlpKeyValue {
  key: string;
  value: OtlpAnyValue;
}

/**
 * Represents any value in OTLP format
 */
interface OtlpAnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: number | string;
  doubleValue?: number;
  arrayValue?: { values: OtlpAnyValue[] };
  kvlistValue?: { values: OtlpKeyValue[] };
  bytesValue?: Buffer;
}

/**
 * Represents a log record in OTLP format
 */
interface OtlpLogRecord {
  timeUnixNano: string | number;
  observedTimeUnixNano: string | number;
  severityNumber?: number;
  severityText?: string;
  body?: OtlpAnyValue;
  attributes: OtlpKeyValue[];
  droppedAttributesCount: number;
  flags?: number;
  traceId?: Buffer | string;
  spanId?: Buffer | string;
}

/**
 * Represents scope logs in OTLP format
 */
interface OtlpScopeLogs {
  scope?: {
    name: string;
    version?: string;
    attributes?: OtlpKeyValue[];
  };
  logRecords: OtlpLogRecord[];
  schemaUrl?: string;
}

/**
 * Represents resource logs in OTLP format
 */
interface OtlpResourceLogs {
  resource?: {
    attributes: OtlpKeyValue[];
    droppedAttributesCount?: number;
  };
  scopeLogs: OtlpScopeLogs[];
  schemaUrl?: string;
}

/**
 * Represents the export logs service request in OTLP format
 */
interface ExportLogsServiceRequest {
  resourceLogs: OtlpResourceLogs[];
}

/**
 * Parsed log entry with extracted span fields for easier testing
 */
export interface ParsedLogEntry {
  timestamp: string;
  observedTimestamp: string;
  level: string;
  severityNumber: number;
  body: string;
  attributes: Record<string, string | number | boolean>;
  // Span fields (extracted from attributes)
  context?: string;
  resourceType?: string;
  resourceName?: string;
  spanName?: string;
  // Resource info
  serviceName?: string;
  serviceVersion?: string;
}

/**
 * Mock OTLP gRPC Logs Server
 */
export class OtlpMockServer {
  private server: grpc.Server;
  private receivedLogs: ParsedLogEntry[] = [];
  private port: number;
  private isRunning = false;

  constructor(port = 0) {
    this.port = port;
    this.server = new grpc.Server();
  }

  /**
   * Starts the mock OTLP gRPC server
   * @returns The actual port the server is listening on
   */
  async start(): Promise<number> {
    if (this.isRunning) {
      return this.port;
    }

    // Use on-disk proto files
    const protoDir = path.join(__dirname, "..", "..", "proto");
    const protoFile = path.join(protoDir, "logs_service.proto");

    // Load the proto definition
    const packageDefinition = protoLoader.loadSync(protoFile, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [protoDir],
    });

    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);

    // Get the LogsService
    const logsService = (
      protoDescriptor.opentelemetry as {
        proto: {
          collector: {
            logs: {
              v1: {
                LogsService: grpc.ServiceClientConstructor;
              };
            };
          };
        };
      }
    ).proto.collector.logs.v1.LogsService;

    // Add the service implementation
    this.server.addService(logsService.service, {
      Export: this.handleExport.bind(this),
    });

    // Bind to the port
    return new Promise((resolve, reject) => {
      testLogger.info(`Binding OTLP mock server to 0.0.0.0:${this.port}`);
      this.server.bindAsync(
        `0.0.0.0:${this.port}`,
        grpc.ServerCredentials.createInsecure(),
        (err, boundPort) => {
          if (err) {
            testLogger.error(`Failed to bind OTLP server: ${err.message}`);
            reject(err);
            return;
          }
          this.port = boundPort;
          this.isRunning = true;
          testLogger.info(
            `OTLP mock server listening on 0.0.0.0:${boundPort} (gRPC insecure)`,
          );
          resolve(boundPort);
        },
      );
    });
  }

  /**
   * Handles the Export RPC call
   */
  private handleExport(
    call: grpc.ServerUnaryCall<ExportLogsServiceRequest, unknown>,
    callback: grpc.sendUnaryData<unknown>,
  ): void {
    try {
      const request = call.request;

      // Check for both camelCase and snake_case field names
      const resourceLogs =
        (request as any).resourceLogs || (request as any).resource_logs || [];
      testLogger.debug(
        `OTLP Export received: ${resourceLogs.length} resource logs`,
      );

      // Parse and store the log records
      for (const resLogs of resourceLogs) {
        const resourceAttributes = this.parseAttributes(
          resLogs.resource?.attributes || [],
        );

        // Handle both camelCase and snake_case for scopeLogs
        const scopeLogsList = resLogs.scopeLogs || resLogs.scope_logs || [];
        for (const scopeLogs of scopeLogsList) {
          // Handle both camelCase and snake_case for logRecords
          const logRecordsList =
            scopeLogs.logRecords || scopeLogs.log_records || [];
          for (const logRecord of logRecordsList) {
            const parsed = this.parseLogRecord(logRecord, resourceAttributes);
            this.receivedLogs.push(parsed);
            testLogger.debug(`Received log: ${parsed.body}`, {
              context: parsed.context,
              resourceType: parsed.resourceType,
              resourceName: parsed.resourceName,
            });
          }
        }
      }

      // Return success response
      callback(null, { partialSuccess: null });
    } catch (error) {
      testLogger.error(`Error handling export request: ${error}`);
      callback({
        code: grpc.status.INTERNAL,
        message: `Error processing request: ${error}`,
      });
    }
  }

  /**
   * Parses attributes array into a record
   */
  private parseAttributes(
    attrs: OtlpKeyValue[],
  ): Record<string, string | number | boolean> {
    const result: Record<string, string | number | boolean> = {};
    for (const attr of attrs) {
      const value = this.parseAnyValue(attr.value);
      if (value !== undefined) {
        result[attr.key] = value;
      }
    }
    return result;
  }

  /**
   * Parses an OTLP AnyValue to a primitive
   * Handles both camelCase and snake_case field names from proto parsing
   */
  private parseAnyValue(
    value: OtlpAnyValue,
  ): string | number | boolean | undefined {
    const v = value as any;
    // Handle both camelCase and snake_case
    const stringVal = v.stringValue ?? v.string_value;
    if (stringVal !== undefined) return stringVal;

    const boolVal = v.boolValue ?? v.bool_value;
    if (boolVal !== undefined) return boolVal;

    const intVal = v.intValue ?? v.int_value;
    if (intVal !== undefined) {
      return typeof intVal === "string" ? parseInt(intVal, 10) : intVal;
    }

    const doubleVal = v.doubleValue ?? v.double_value;
    if (doubleVal !== undefined) return doubleVal;

    return undefined;
  }

  /**
   * Parses a log record into our simpler format
   */
  private parseLogRecord(
    record: OtlpLogRecord,
    resourceAttributes: Record<string, string | number | boolean>,
  ): ParsedLogEntry {
    const rec = record as any; // Allow snake_case access
    const attributes = this.parseAttributes(rec.attributes || []);

    // Extract body as string
    let body = "";
    const bodyValue = rec.body;
    if (bodyValue) {
      const strValue = bodyValue.stringValue || bodyValue.string_value;
      if (strValue) {
        body = strValue;
      } else {
        body = JSON.stringify(bodyValue);
      }
    }

    // Convert timestamps (handle both camelCase and snake_case, and undefined values)
    const timeNanoRaw = rec.timeUnixNano || rec.time_unix_nano || "0";
    const observedTimeNanoRaw =
      rec.observedTimeUnixNano || rec.observed_time_unix_nano || "0";

    const timeNano =
      typeof timeNanoRaw === "string" ?
        BigInt(timeNanoRaw)
      : BigInt(timeNanoRaw || 0);
    const observedTimeNano =
      typeof observedTimeNanoRaw === "string" ?
        BigInt(observedTimeNanoRaw)
      : BigInt(observedTimeNanoRaw || 0);

    const timestamp = new Date(
      Number(timeNano / BigInt(1000000)),
    ).toISOString();
    const observedTimestamp = new Date(
      Number(observedTimeNano / BigInt(1000000)),
    ).toISOString();

    // Get severity (handle both camelCase and snake_case)
    const severityText = rec.severityText || rec.severity_text || "";
    const severityNumber = rec.severityNumber || rec.severity_number || 0;

    return {
      timestamp,
      observedTimestamp,
      level: severityText,
      severityNumber: typeof severityNumber === "string" ? 0 : severityNumber,
      body,
      attributes,
      // Extract span fields from attributes (these come from the tracing bridge)
      context: attributes["context"] as string | undefined,
      resourceType: attributes["resource_type"] as string | undefined,
      resourceName: attributes["resource_name"] as string | undefined,
      spanName: attributes["name"] as string | undefined,
      // Resource info
      serviceName: resourceAttributes["service.name"] as string | undefined,
      serviceVersion: resourceAttributes["service.version"] as
        | string
        | undefined,
    };
  }

  /**
   * Gets all received logs
   */
  getLogs(): ParsedLogEntry[] {
    return [...this.receivedLogs];
  }

  /**
   * Clears all received logs
   */
  clearLogs(): void {
    this.receivedLogs = [];
  }

  /**
   * Filters logs by span fields
   */
  filterLogs(filters: {
    context?: string;
    resourceType?: string;
    resourceName?: string;
    bodyContains?: string;
  }): ParsedLogEntry[] {
    return this.receivedLogs.filter((log) => {
      if (filters.context && log.context !== filters.context) return false;
      if (filters.resourceType && log.resourceType !== filters.resourceType)
        return false;
      if (filters.resourceName && log.resourceName !== filters.resourceName)
        return false;
      if (filters.bodyContains && !log.body.includes(filters.bodyContains))
        return false;
      return true;
    });
  }

  /**
   * Waits for logs matching the given filters
   */
  async waitForLogs(
    filters: {
      context?: string;
      resourceType?: string;
      resourceName?: string;
      bodyContains?: string;
    },
    options: {
      timeoutMs?: number;
      intervalMs?: number;
      minCount?: number;
    } = {},
  ): Promise<ParsedLogEntry[]> {
    const timeoutMs = options.timeoutMs || 30000;
    const intervalMs = options.intervalMs || 100;
    const minCount = options.minCount || 1;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const matching = this.filterLogs(filters);
      if (matching.length >= minCount) {
        return matching;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(
      `Timeout waiting for OTLP logs matching filters: ${JSON.stringify(filters)}. ` +
        `Expected at least ${minCount} entries, got ${this.filterLogs(filters).length}. ` +
        `Total logs received: ${this.receivedLogs.length}`,
    );
  }

  /**
   * Stops the server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    return new Promise((resolve) => {
      this.server.tryShutdown(() => {
        this.isRunning = false;
        testLogger.info("OTLP mock server stopped");
        resolve();
      });
    });
  }

  /**
   * Gets the endpoint URL for this server
   */
  getEndpoint(): string {
    return `http://localhost:${this.port}`;
  }

  /**
   * Gets the port the server is listening on
   */
  getPort(): number {
    return this.port;
  }
}

/**
 * Creates and starts an OTLP mock server
 * @param port Optional port to listen on (0 for random port)
 * @returns The started server instance
 */
export async function createOtlpMockServer(port = 0): Promise<OtlpMockServer> {
  const server = new OtlpMockServer(port);
  await server.start();
  return server;
}
