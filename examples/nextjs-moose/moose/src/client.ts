import { getMooseClients, Sql, QueryClient, sql } from "@514labs/moose-lib";

async function getClickhouseClient(): Promise<QueryClient> {
  const { client } = await getMooseClients({
    host: process.env.MOOSE_CLICKHOUSE_CONFIG__HOST ?? "localhost",
    port: process.env.MOOSE_CLICKHOUSE_CONFIG__PORT ?? "18123",
    username: process.env.MOOSE_CLICKHOUSE_CONFIG__USER ?? "panda",
    password: process.env.MOOSE_CLICKHOUSE_CONFIG__PASSWORD ?? "pandapass",
    database: process.env.MOOSE_CLICKHOUSE_CONFIG__DB_NAME ?? "local",
    useSSL:
      (process.env.MOOSE_CLICKHOUSE_CONFIG__USE_SSL ?? "false") === "true",
  });

  return client.query;
}

export const db = () => getClickhouseClient();

export async function executeQuery<T>(query: Sql): Promise<T[]> {
  const queryClient = await getClickhouseClient();
  const result = await queryClient.execute(query);
  return result.json();
}
