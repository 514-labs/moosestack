import { readProjectConfig } from "./configFile";

interface RuntimeClickHouseConfig {
  host: string;
  port: string;
  username: string;
  password: string;
  database: string;
  useSSL: boolean;
}

interface RuntimeKafkaConfig {
  broker: string;
  messageTimeoutMs: number;
  saslUsername?: string;
  saslPassword?: string;
  saslMechanism?: string;
  securityProtocol?: string;
  namespace?: string;
  schemaRegistryUrl?: string;
}

class ConfigurationRegistry {
  private static instance: ConfigurationRegistry;
  private clickhouseConfig?: RuntimeClickHouseConfig;
  private kafkaConfig?: RuntimeKafkaConfig;

  static getInstance(): ConfigurationRegistry {
    if (!ConfigurationRegistry.instance) {
      ConfigurationRegistry.instance = new ConfigurationRegistry();
    }
    return ConfigurationRegistry.instance;
  }

  setClickHouseConfig(config: RuntimeClickHouseConfig): void {
    this.clickhouseConfig = config;
  }

  setKafkaConfig(config: RuntimeKafkaConfig): void {
    this.kafkaConfig = config;
  }

  private _env(name: string): string | undefined {
    const value = process.env[name];
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private _parseBool(value: string | undefined): boolean | undefined {
    if (value === undefined) return undefined;
    switch (value.trim().toLowerCase()) {
      case "1":
      case "true":
      case "yes":
      case "on":
        return true;
      case "0":
      case "false":
      case "no":
      case "off":
        return false;
      default:
        return undefined;
    }
  }

  async getClickHouseConfig(): Promise<RuntimeClickHouseConfig> {
    if (this.clickhouseConfig) {
      return this.clickhouseConfig;
    }

    // Fallback to reading from config file for backward compatibility
    const projectConfig = await readProjectConfig();
    const envHost = this._env("MOOSE_CLICKHOUSE_CONFIG__HOST");
    const envPort = this._env("MOOSE_CLICKHOUSE_CONFIG__HOST_PORT");
    const envUser = this._env("MOOSE_CLICKHOUSE_CONFIG__USER");
    const envPassword = this._env("MOOSE_CLICKHOUSE_CONFIG__PASSWORD");
    const envDb = this._env("MOOSE_CLICKHOUSE_CONFIG__DB_NAME");
    const envUseSSL = this._parseBool(
      this._env("MOOSE_CLICKHOUSE_CONFIG__USE_SSL"),
    );

    return {
      host: envHost ?? projectConfig.clickhouse_config.host,
      port: envPort ?? projectConfig.clickhouse_config.host_port.toString(),
      username: envUser ?? projectConfig.clickhouse_config.user,
      password: envPassword ?? projectConfig.clickhouse_config.password,
      database: envDb ?? projectConfig.clickhouse_config.db_name,
      useSSL:
        envUseSSL !== undefined ? envUseSSL : (
          projectConfig.clickhouse_config.use_ssl || false
        ),
    };
  }

  async getStandaloneClickhouseConfig(
    overrides?: Partial<RuntimeClickHouseConfig>,
  ): Promise<RuntimeClickHouseConfig> {
    if (this.clickhouseConfig) {
      return { ...this.clickhouseConfig, ...overrides };
    }

    const envHost = this._env("MOOSE_CLICKHOUSE_CONFIG__HOST");
    const envPort = this._env("MOOSE_CLICKHOUSE_CONFIG__HOST_PORT");
    const envUser = this._env("MOOSE_CLICKHOUSE_CONFIG__USER");
    const envPassword = this._env("MOOSE_CLICKHOUSE_CONFIG__PASSWORD");
    const envDb = this._env("MOOSE_CLICKHOUSE_CONFIG__DB_NAME");
    const envUseSSL = this._parseBool(
      this._env("MOOSE_CLICKHOUSE_CONFIG__USE_SSL"),
    );

    let projectConfig;
    try {
      projectConfig = await readProjectConfig();
    } catch (error) {
      projectConfig = null;
    }

    const defaults = {
      host: "localhost",
      port: "18123",
      username: "default",
      password: "",
      database: "local",
      useSSL: false,
    };

    return {
      host:
        overrides?.host ??
        envHost ??
        projectConfig?.clickhouse_config.host ??
        defaults.host,
      port:
        overrides?.port ??
        envPort ??
        projectConfig?.clickhouse_config.host_port.toString() ??
        defaults.port,
      username:
        overrides?.username ??
        envUser ??
        projectConfig?.clickhouse_config.user ??
        defaults.username,
      password:
        overrides?.password ??
        envPassword ??
        projectConfig?.clickhouse_config.password ??
        defaults.password,
      database:
        overrides?.database ??
        envDb ??
        projectConfig?.clickhouse_config.db_name ??
        defaults.database,
      useSSL:
        overrides?.useSSL ??
        envUseSSL ??
        projectConfig?.clickhouse_config.use_ssl ??
        defaults.useSSL,
    };
  }

  async getKafkaConfig(): Promise<RuntimeKafkaConfig> {
    if (this.kafkaConfig) {
      return this.kafkaConfig;
    }

    const projectConfig = await readProjectConfig();

    const envBroker =
      this._env("MOOSE_REDPANDA_CONFIG__BROKER") ??
      this._env("MOOSE_KAFKA_CONFIG__BROKER");
    const envMsgTimeout =
      this._env("MOOSE_REDPANDA_CONFIG__MESSAGE_TIMEOUT_MS") ??
      this._env("MOOSE_KAFKA_CONFIG__MESSAGE_TIMEOUT_MS");
    const envSaslUsername =
      this._env("MOOSE_REDPANDA_CONFIG__SASL_USERNAME") ??
      this._env("MOOSE_KAFKA_CONFIG__SASL_USERNAME");
    const envSaslPassword =
      this._env("MOOSE_REDPANDA_CONFIG__SASL_PASSWORD") ??
      this._env("MOOSE_KAFKA_CONFIG__SASL_PASSWORD");
    const envSaslMechanism =
      this._env("MOOSE_REDPANDA_CONFIG__SASL_MECHANISM") ??
      this._env("MOOSE_KAFKA_CONFIG__SASL_MECHANISM");
    const envSecurityProtocol =
      this._env("MOOSE_REDPANDA_CONFIG__SECURITY_PROTOCOL") ??
      this._env("MOOSE_KAFKA_CONFIG__SECURITY_PROTOCOL");
    const envNamespace =
      this._env("MOOSE_REDPANDA_CONFIG__NAMESPACE") ??
      this._env("MOOSE_KAFKA_CONFIG__NAMESPACE");
    const envSchemaRegistryUrl =
      this._env("MOOSE_REDPANDA_CONFIG__SCHEMA_REGISTRY_URL") ??
      this._env("MOOSE_KAFKA_CONFIG__SCHEMA_REGISTRY_URL") ??
      this._env("SCHEMA_REGISTRY_URL");

    const fileKafka =
      projectConfig.kafka_config ?? projectConfig.redpanda_config;

    return {
      broker: envBroker ?? fileKafka?.broker ?? "localhost:19092",
      messageTimeoutMs:
        envMsgTimeout ?
          parseInt(envMsgTimeout, 10)
        : (fileKafka?.message_timeout_ms ?? 1000),
      saslUsername: envSaslUsername ?? fileKafka?.sasl_username,
      saslPassword: envSaslPassword ?? fileKafka?.sasl_password,
      saslMechanism: envSaslMechanism ?? fileKafka?.sasl_mechanism,
      securityProtocol: envSecurityProtocol ?? fileKafka?.security_protocol,
      namespace: envNamespace ?? fileKafka?.namespace,
      schemaRegistryUrl: envSchemaRegistryUrl ?? fileKafka?.schema_registry_url,
    };
  }

  hasRuntimeConfig(): boolean {
    return !!this.clickhouseConfig || !!this.kafkaConfig;
  }
}

(globalThis as any)._mooseConfigRegistry = ConfigurationRegistry.getInstance();
export type {
  ConfigurationRegistry,
  RuntimeClickHouseConfig,
  RuntimeKafkaConfig,
};
