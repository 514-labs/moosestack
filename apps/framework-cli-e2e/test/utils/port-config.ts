/**
 * Port configuration for E2E test suites.
 *
 * Each test file uses a unique port offset so that multiple test suites
 * can run in parallel on the same machine without port conflicts.
 */

/**
 * All infrastructure ports used by a single Moose dev server instance.
 */
export interface TestPorts {
  /** Moose HTTP ingestion / API server */
  httpPort: number;
  /** Moose management / console server */
  managementPort: number;
  /** Consumption API proxy server */
  proxyPort: number;
  /** ClickHouse HTTP port */
  clickhouseHttpPort: number;
  /** ClickHouse native TCP port */
  clickhouseNativePort: number;
  /** Embedded ClickHouse Keeper (ZooKeeper) TCP port */
  keeperPort: number;
  /** Embedded ClickHouse Keeper Raft consensus port */
  keeperRaftPort: number;
  /** Kafka / devkafka broker port */
  kafkaPort: number;
  /** Redis / devredis port */
  redisPort: number;
  /** Temporal gRPC port */
  temporalPort: number;
}

export interface ClickHouseClientConfig {
  url: string;
  username: string;
  password: string;
  database: string;
}

export interface ServerEndpointsConfig {
  url: string;
  managementUrl: string;
  startupMessage: string;
}

/**
 * Default ports (offset 0).
 *
 * Redis intentionally uses a non-standard base port so dockerless E2E runs do
 * not collide with a developer's local Redis daemon on 6379.
 */
const BASE_PORTS: TestPorts = {
  httpPort: 4000,
  managementPort: 5001,
  proxyPort: 4001,
  clickhouseHttpPort: 18123,
  clickhouseNativePort: 19000,
  keeperPort: 9181,
  keeperRaftPort: 9234,
  kafkaPort: 19092,
  redisPort: 16379,
  temporalPort: 7233,
};

/**
 * Compute a unique set of ports for a test suite.
 *
 * @param offset - A unique offset per test file (e.g. 0, 10, 20, 30, …).
 *                 Each port is incremented by this value.
 */
export function getTestPorts(offset: number): TestPorts {
  return {
    httpPort: BASE_PORTS.httpPort + offset,
    managementPort: BASE_PORTS.managementPort + offset,
    proxyPort: BASE_PORTS.proxyPort + offset,
    clickhouseHttpPort: BASE_PORTS.clickhouseHttpPort + offset,
    clickhouseNativePort: BASE_PORTS.clickhouseNativePort + offset,
    keeperPort: BASE_PORTS.keeperPort + offset,
    keeperRaftPort: BASE_PORTS.keeperRaftPort + offset,
    kafkaPort: BASE_PORTS.kafkaPort + offset,
    redisPort: BASE_PORTS.redisPort + offset,
    temporalPort: BASE_PORTS.temporalPort + offset,
  };
}

/**
 * Build the MOOSE_* environment variables that configure all infrastructure
 * ports for a `moose dev --dockerless` process.
 */
export function buildPortEnv(ports: TestPorts): Record<string, string> {
  return {
    MOOSE_HTTP_SERVER_CONFIG__PORT: `${ports.httpPort}`,
    MOOSE_HTTP_SERVER_CONFIG__MANAGEMENT_PORT: `${ports.managementPort}`,
    MOOSE_HTTP_SERVER_CONFIG__PROXY_PORT: `${ports.proxyPort}`,
    MOOSE_CLICKHOUSE_CONFIG__HOST_PORT: `${ports.clickhouseHttpPort}`,
    MOOSE_CLICKHOUSE_CONFIG__NATIVE_PORT: `${ports.clickhouseNativePort}`,
    MOOSE_CLICKHOUSE_CONFIG__KEEPER_PORT: `${ports.keeperPort}`,
    MOOSE_CLICKHOUSE_CONFIG__KEEPER_RAFT_PORT: `${ports.keeperRaftPort}`,
    MOOSE_REDPANDA_CONFIG__BROKER: `127.0.0.1:${ports.kafkaPort}`,
    MOOSE_REDIS_CONFIG__PORT: `${ports.redisPort}`,
    MOOSE_TEMPORAL_CONFIG__TEMPORAL_PORT: `${ports.temporalPort}`,
  };
}

/**
 * Build a ClickHouse client config object for the given ports.
 */
export function buildClickHouseConfig(
  ports: TestPorts,
): ClickHouseClientConfig {
  return {
    url: `http://localhost:${ports.clickhouseHttpPort}`,
    username: "panda",
    password: "pandapass",
    database: "local",
  };
}

/**
 * Build a server config object for the given ports.
 */
export function buildServerConfig(ports: TestPorts): ServerEndpointsConfig {
  return {
    url: `http://localhost:${ports.httpPort}`,
    managementUrl: `http://localhost:${ports.managementPort}`,
    startupMessage: `Your local development server is running at: http://localhost:${ports.httpPort}/ingest`,
  };
}
