import path from "node:path";
import * as toml from "toml";

/**
 * ClickHouse configuration from moose.config.toml
 */
export interface ClickHouseConfig {
  host: string;
  host_port: number;
  user: string;
  password: string;
  db_name: string;
  use_ssl?: boolean;
  native_port?: number;
}

/**
 * Redpanda/Kafka configuration from moose.config.toml
 */
export interface KafkaConfig {
  /** Broker connection string (e.g., "host:port" or comma-separated list) */
  broker: string;
  /** Message timeout in milliseconds */
  message_timeout_ms: number;
  /** Default retention period in milliseconds */
  retention_ms: number;
  /** Topic replication factor */
  replication_factor?: number;
  /** SASL username for authentication, if required */
  sasl_username?: string;
  /** SASL password for authentication, if required */
  sasl_password?: string;
  /** SASL mechanism (e.g., "PLAIN", "SCRAM-SHA-256") */
  sasl_mechanism?: string;
  /** Security protocol (e.g., "SASL_SSL", "PLAINTEXT") */
  security_protocol?: string;
  /** Optional namespace used as a prefix for topics */
  namespace?: string;
}

/**
 * Project configuration from moose.config.toml
 */
export interface ProjectConfig {
  language: string;
  clickhouse_config: ClickHouseConfig;
  /**
   * Redpanda/Kafka configuration. Historically named `kafka_config` in some places.
   * Prefer `redpanda_config` but support both for backward compatibility.
   */
  redpanda_config?: KafkaConfig;
  kafka_config?: KafkaConfig;
}

/**
 * Error thrown when configuration cannot be found or parsed
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Walks up the directory tree to find moose.config.toml
 */
async function findConfigFile(
  startDir: string = process.cwd(),
): Promise<string | null> {
  const fs = await import("node:fs");

  let currentDir = path.resolve(startDir);

  while (true) {
    const configPath = path.join(currentDir, "moose.config.toml");
    if (fs.existsSync(configPath)) {
      return configPath;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached root directory
      break;
    }
    currentDir = parentDir;
  }

  return null;
}

/**
 * Reads and parses the project configuration from moose.config.toml
 */
export async function readProjectConfig(): Promise<ProjectConfig> {
  const fs = await import("node:fs");
  const configPath = await findConfigFile();
  if (!configPath) {
    throw new ConfigError(
      "moose.config.toml not found in current directory or any parent directory",
    );
  }

  try {
    const configContent = fs.readFileSync(configPath, "utf-8");
    const config = toml.parse(configContent) as ProjectConfig;
    return config;
  } catch (error) {
    throw new ConfigError(`Failed to parse moose.config.toml: ${error}`);
  }
}
