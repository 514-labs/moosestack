import { getMooseClients } from "@514labs/moose-lib";

const globalForMoose = globalThis as unknown as {
  mooseClient: Awaited<ReturnType<typeof getMooseClients>> | undefined;
};

export async function getMoose() {
  if (globalForMoose.mooseClient) {
    return globalForMoose.mooseClient;
  }

  const client = await getMooseClients({
    database: process.env.MOOSE_CLICKHOUSE_CONFIG__DB_NAME!,
    host: process.env.MOOSE_CLICKHOUSE_CONFIG__HOST!,
    port: process.env.MOOSE_CLICKHOUSE_CONFIG__PORT!,
    username: process.env.MOOSE_CLICKHOUSE_CONFIG__USER!,
    password: process.env.MOOSE_CLICKHOUSE_CONFIG__PASSWORD!,
    useSSL: process.env.MOOSE_CLICKHOUSE_CONFIG__USE_SSL === "true",
  });

  if (process.env.NODE_ENV !== "production") {
    globalForMoose.mooseClient = client;
  }

  return client;
}
