import { readProjectConfig } from "./configFile";

interface RuntimeClickHouseConfig {
  host: string;
  port: string;
  username: string;
  password: string;
  database: string;
  useSSL: boolean;
}

class ConfigurationRegistry {
  private static instance: ConfigurationRegistry;
  private clickhouseConfig?: RuntimeClickHouseConfig;

  static getInstance(): ConfigurationRegistry {
    if (!ConfigurationRegistry.instance) {
      ConfigurationRegistry.instance = new ConfigurationRegistry();
    }
    return ConfigurationRegistry.instance;
  }

  setClickHouseConfig(config: RuntimeClickHouseConfig): void {
    this.clickhouseConfig = config;
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

  hasRuntimeConfig(): boolean {
    return !!this.clickhouseConfig;
  }
}

(globalThis as any)._mooseConfigRegistry = ConfigurationRegistry.getInstance();
export type { ConfigurationRegistry, RuntimeClickHouseConfig };
