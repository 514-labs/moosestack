<a href="https://docs.fiveonefour.com/moosestack/"><img src="https://raw.githubusercontent.com/514-labs/moose/main/logo-m-light.png" alt="moose logo" height="100px"></a>

[![Made by Fiveonefour](https://img.shields.io/badge/MADE%20BY-Fiveonefour-black.svg)](https://www.fiveonefour.com)
[![NPM Version](https://img.shields.io/npm/v/%40514labs%2Fmoose-cli?logo=npm)](https://www.npmjs.com/package/@514labs/moose-cli?activeTab=readme)
[![MooseStack Community](https://img.shields.io/badge/Slack-MooseStack_community-purple.svg?logo=slack)](http://slack.moosestack.com)
[![Docs](https://img.shields.io/badge/Quickstart-Docs-blue.svg)](https://docs.fiveonefour.com/moosestack/getting-started/quickstart)
[![MIT license](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

# MooseStack

**The ClickHouse-native developer framework and agent harness for building real-time analytical backends in TypeScript and Python** — designed for developers and AI coding agents alike.

MooseStack offers a unified, type‑safe, code‑first developer experience layer for [ClickHouse](https://clickhouse.com/) (realtime analytical database), [Kafka](https://kafka.apache.org/)/[Redpanda](https://redpanda.com/) (realtime streaming), and [Temporal](https://temporal.io/) (workflow orchestration). So you can integrate real time analytical infrastructure into your application stack in native Typescript or Python.

Because your entire analytical stack is captured in code, AI agents can read, write, and refactor it just like any other part of your application. Combined with fast local feedback loops via `moose dev` and complementary [ClickHouse best-practice agent skills](https://github.com/514-labs/agent-skills), agents can often handle the bulk of your development work — schema design, materialized views, migrations, and query APIs — while you review and steer.

## Why MooseStack?

- **AI agent harness**: AI-friendly interfaces enable coding agents to iterate quickly and safely on your analytical workloads
- **Git-native development**: Version control, collaboration, and governance built-in
- **Local-first experience**: Full mirror of production environment on your laptop with `moose dev`
- **Schema & migration management**: Typed schemas in your application code, with automated schema migration support
- **Code‑first infrastructure**: Declare tables, streams, workflows, and APIs in TS/Python -> MooseStack wires it all up
- **Modular design**: Only enable the modules you need. Each module is independent and can be adopted incrementally

## MooseStack Modules

- [Moose **OLAP**](https://docs.fiveonefour.com/moosestack/olap): Manage ClickHouse tables, materialized views, and migrations in code.
- [Moose **Streaming**](https://docs.fiveonefour.com/moosestack/streaming): Real‑time ingest buffers and streaming transformation functions with Kafka/Redpanda.
- [Moose **Workflows**](https://docs.fiveonefour.com/moosestack/workflows): ETL pipelines and tasks with Temporal.
- [Moose **APIs** and Web apps](https://docs.fiveonefour.com/moosestack/apis): Type‑safe ingestion and query endpoints, or bring your own API framework (Nextjs, Express, FastAPI, Fastify, etc)

## MooseStack Tooling:
- [Moose **Dev**](https://docs.fiveonefour.com/moosestack/dev): Local dev server with hot-reloading infrastructure
- [Moose **Dev MCP**](https://docs.fiveonefour.com/moosestack/moosedev-mcp): AI agent interface to your local dev stack
- [Moose **Language Server / LSP**](https://docs.fiveonefour.com/moosestack/language-server): In-editor diagnostics and autocomplete for agents and devs
- [ClickHouse TS/Py **Agent Skills**](https://github.com/514-labs/agent-skills): ClickHouse best practices as agent-readable rules
- [Moose **Migrate**](https://docs.fiveonefour.com/moosestack/migrate): Code-based schema migrations for ClickHouse
- [Moose **Deploy**](https://docs.fiveonefour.com/moosestack/deploying): Ship your app to production

## Quickstart

Also available in the Docs: [5-minute Quickstart](https://docs.fiveonefour.com/moosestack/getting-started/quickstart)

Already running Clickhouse: [Getting Started with Existing Clickhouse](https://docs.fiveonefour.com/moosestack/getting-started/from-clickhouse)

### Install the CLI

```bash
bash -i <(curl -fsSL https://fiveonefour.com/install.sh) moose
```

### Create a project

```bash
# typescript
moose init my-project --from-remote <YOUR_CLICKHOUSE_CONNECTION_STRING> --language typescript

# python
moose init my-project --from-remote <YOUR_CLICKHOUSE_CONNECTION_STRING> --language python
```

### Run locally

```bash
cd my-project
npm install  # or: pip install -r requirements.txt
moose dev
```

MooseStack will start ClickHouse, Redpanda, Temporal, and Redis; the CLI validates each component.

## Deploy with Fiveonefour hosting

The fastest way to deploy your MooseStack application is with [hosting from Fiveonefour](https://fiveonefour.boreal.cloud/sign-up), the creators of MooseStack. Fiveonefour provides automated preview branches, managed schema migrations, deep integration with Github and CI/CD, and an agentic harness for your realtime analytical infrastructure in the cloud.

[Get started with Fiveonefour hosting →](https://fiveonefour.boreal.cloud/sign-up)

## Deploy Yourself

MooseStack is open source and can be self-hosted. If you're only using MooseOLAP, you can use the Moose library in your app for schema management, migrations, and typed queries on your ClickHouse database without deploying the Moose runtime. For detailed self-hosting instructions, see our [deployment documentation](https://docs.fiveonefour.com/moosestack/deploying).

## Examples

### TypeScript 

```typescript
import { Key, OlapTable, Stream, IngestApi, ConsumptionApi } from "@514labs/moose-lib";
 
interface DataModel {
  primaryKey: Key<string>;
  name: string;
}
// Create a ClickHouse table
export const clickhouseTable = new OlapTable<DataModel>("TableName");
 
// Create a Redpanda streaming topic
export const redpandaTopic = new Stream<DataModel>("TopicName", {
  destination: clickhouseTable,
});
 
// Create an ingest API endpoint
export const ingestApi = new IngestApi<DataModel>("post-api-route", {
  destination: redpandaTopic,
});
 
// Create consumption API endpoint
interface QueryParams {
  limit?: number;
}
export const consumptionApi = new ConsumptionApi<QueryParams, DataModel[]>("get-api-route", 
  async ({limit = 10}: QueryParams, {client, sql}) => {
    const result = await client.query.execute(sql`SELECT * FROM ${clickhouseTable} LIMIT ${limit}`);
    return await result.json();
  }
);
```
### Python 

```python
from moose_lib import Key, OlapTable, Stream, StreamConfig, IngestApi, IngestApiConfig, ConsumptionApi
from pydantic import BaseModel
 
class DataModel(BaseModel):
    primary_key: Key[str]
    name: str
 
# Create a ClickHouse table
clickhouse_table = OlapTable[DataModel]("TableName")
 
# Create a Redpanda streaming topic
redpanda_topic = Stream[DataModel]("TopicName", StreamConfig(
    destination=clickhouse_table,
))
 
# Create an ingest API endpoint
ingest_api = IngestApi[DataModel]("post-api-route", IngestApiConfig(
    destination=redpanda_topic,
))
 
# Create a consumption API endpoint
class QueryParams(BaseModel):
    limit: int = 10
 
def handler(client, params: QueryParams):
    return client.query.execute("SELECT * FROM {table: Identifier} LIMIT {limit: Int32}", {
        "table": clickhouse_table.name,
        "limit": params.limit,
    })
 
consumption_api = ConsumptionApi[RequestParams, DataModel]("get-api-route", query_function=handler)
```

## Docs

- [Overview](https://docs.fiveonefour.com/moosestack)
- [5-min Quickstart](https://docs.fiveonefour.com/moosestack/getting-started/quickstart)
- [Quickstart with Existing Clickhouse](https://docs.fiveonefour.com/moosestack/getting-started/from-clickhouse)

## Built on

- [ClickHouse](https://clickhouse.com/) (OLAP storage)
- [Redpanda](https://redpanda.com/) (streaming)
- [Temporal](https://temporal.io/) (workflow orchestration)
- [Redis](https://redis.io/) (internal state)

## Community

[Join us on Slack](https://join.slack.com/t/moose-community/shared_invite/zt-2fjh5n3wz-cnOmM9Xe9DYAgQrNu8xKxg)

## Cursor Background Agents

MooseStack works with Cursor's background agents for remote development. The repository includes a pre-configured Docker-in-Docker setup that enables Moose's Docker dependencies to run in the agent environment.

### Quick Setup
1. Enable background agents in Cursor
2. The environment will automatically build with Docker support
3. Run `moose dev` or other Moose commands in the agent

For detailed setup instructions and troubleshooting, see [Docker Setup Documentation](.cursor/DOCKER_SETUP.md).

## Contributing

We welcome contributions! See the [contribution guidelines](https://github.com/514-labs/moosestack/blob/main/CONTRIBUTING.md).

## License

MooseStack is open source software and MIT licensed.
