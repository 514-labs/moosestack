import { getMooseClients, Sql } from "@514labs/moose-lib";

let clientsPromise:
  | Promise<Awaited<ReturnType<typeof getMooseClients>>>
  | undefined;

async function getMoose() {
  // Keep env loading as an application concern.
  // In this starter, Fastify loads `.env` via `node --env-file=.env ...`.
  clientsPromise ??= getMooseClients({
    host: process.env.MOOSE_CLICKHOUSE_CONFIG__HOST ?? "localhost",
    port: process.env.MOOSE_CLICKHOUSE_CONFIG__PORT ?? "18123",
    username: process.env.MOOSE_CLICKHOUSE_CONFIG__USER ?? "panda",
    password: process.env.MOOSE_CLICKHOUSE_CONFIG__PASSWORD ?? "pandapass",
    database: process.env.MOOSE_CLICKHOUSE_CONFIG__DB_NAME ?? "local",
    useSSL:
      (process.env.MOOSE_CLICKHOUSE_CONFIG__USE_SSL ?? "false") === "true",
  });

  return await clientsPromise;
}

export async function executeQuery<T>(query: Sql): Promise<T[]> {
  const { client } = await getMoose();
  const result = await client.query.execute(query);
  return result.json();
}
