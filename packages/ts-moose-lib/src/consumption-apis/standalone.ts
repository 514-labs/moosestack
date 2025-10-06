import { MooseClient, QueryClient } from "./helpers";
import { getClickhouseClient } from "../commons";
import type { RuntimeClickHouseConfig } from "../config/runtime";

export async function getMooseClients(
  config?: Partial<RuntimeClickHouseConfig>,
): Promise<{ client: MooseClient }> {
  await import("../config/runtime");
  const configRegistry = (globalThis as any)._mooseConfigRegistry;

  if (!configRegistry) {
    throw new Error(
      "Configuration registry not initialized. Ensure the Moose framework is properly set up.",
    );
  }

  const clickhouseConfig =
    await configRegistry.getStandaloneClickhouseConfig(config);

  const clickhouseClient = getClickhouseClient({
    username: clickhouseConfig.username,
    password: clickhouseConfig.password,
    database: clickhouseConfig.database,
    useSSL: clickhouseConfig.useSSL ? "true" : "false",
    host: clickhouseConfig.host,
    port: clickhouseConfig.port,
  });

  const queryClient = new QueryClient(clickhouseClient, "standalone");
  const mooseClient = new MooseClient(queryClient);

  return { client: mooseClient };
}
