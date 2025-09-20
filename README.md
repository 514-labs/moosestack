<a href="https://docs.fiveonefour.com/moose/"><img src="https://raw.githubusercontent.com/514-labs/moose/main/logo-m-light.png" alt="moose logo" height="100px"></a>

[![Made by Fiveonefour](https://img.shields.io/badge/MADE%20BY-Fiveonefour-black.svg)](https://www.fiveonefour.com)
[![NPM Version](https://img.shields.io/npm/v/%40514labs%2Fmoose-cli?logo=npm)](https://www.npmjs.com/package/@514labs/moose-cli?activeTab=readme)
[![MooseStack Community](https://img.shields.io/badge/Slack-MooseStack_community-purple.svg?logo=slack)](https://join.slack.com/t/moose-community/shared_invite/zt-2fjh5n3wz-cnOmM9Xe9DYAgQrNu8xKxg)
[![Docs](https://img.shields.io/badge/Quickstart-Docs-blue.svg)](https://docs.fiveonefour.com/moose/getting-started/quickstart)
[![MIT license](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

# MooseStack

**Developer toolkit for building real-time analytical backends in Typescript and Python** — MooseStack brings data engineering best practices and a modern web development DX to any engineer building on data infra.

MooseStack modules offer a type‑safe, code‑first developer experience layer for popular open source analytical infrastructure, including [ClickHouse](https://clickhouse.com/), [Kafka](https://kafka.apache.org/), [Redpanda](https://redpanda.com/), and [Temporal](https://temporal.io/).

MooseStack is designed for:
1. Software engineers integrating analytics & AI into their apps, and leaning into real-time / OLAP infrastructure best practices
2. Data engineers building software & AI applications on their data infra, and leaning into software development best practices

## Why MooseStack?

- **Git-native development**: Version control, collaboration, and governance built-in
- **Local-first experience**: Full mirror of production environment on your laptop with `moose dev`
- **Schema & migration management**: typed schemas in your application code, with transparent migration support
- **Code‑first infrastructure**: Declare tables, streams, workflows, and APIs in TS/Python -> MooseStack wires it all up.
- **Modular design**: Only enable the modules you need. Each module is independent and can be adopted incrementally.
- **AI copilot friendly**: Designed from the ground up for LLM-powered development

## MooseStack Modules

- [Moose **OLAP**](https://docs.fiveonefour.com/moose/olap): Manage ClickHouse tables, materialized views, and migrations in code.
- [Moose **Streaming**](https://docs.fiveonefour.com/moose/streaming): Real‑time pipelines with Kafka/Redpanda and transformation functions.
- [Moose **Workflows**](https://docs.fiveonefour.com/moose/workflows): ETL pipelines and tasks with Temporal.
- [Moose **APIs**](https://docs.fiveonefour.com/moose/apis): Type‑safe ingestion and query endpoints with auto‑generated OpenAPI docs.
- MooseStack Tooling: [Moose **Deploy**](https://docs.fiveonefour.com/moose/deploying), [Moose **Migrate**](https://docs.fiveonefour.com/moose/migrate), [Moose **Observability**](https://docs.fiveonefour.com/moose/metrics)

## Quickstart

Also available in the Docs: [5-minute Quickstart](https://docs.fiveonefour.com/moose/getting-started/quickstart)

Already running Clickhouse: [Getting Started with Existing Clickhouse](https://docs.fiveonefour.com/moose/getting-started/from-clickhouse)

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
moose dev
```

MooseStack will start ClickHouse, Redpanda, Temporal, and Redis; the CLI validates each component.

## Deploy with Boreal

The easiest way to deploy your MooseStack Applications is to use [Boreal](https://www.fiveonefour.com/boreal) from 514 Labs, the creators of Moose. Boreal provides zero-config deployments, automatic scaling, managed or BYO infrastructure, monitoring and observability integrations.

[Get started with Boreal →](https://www.fiveonefour.com/boreal)

## Deploy Yourself

Moose is open source and can be self-hosted. For detailed self-hosting instructions, see our [deployment documentation](https://docs.fiveonefour.com/moose/deploying).

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

## 5 Minute Quickstart

**Already running Clickhouse?** MooseStack gives you a modern software DX on your existing ClickHouse or ClickHouse Cloud cluster: [Getting Started with Existing Clickhouse](https://docs.fiveonefour.com/moose/getting-started/quickstart)

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
moose dev
```

MooseStack will start ClickHouse, Redpanda, Temporal, and Redis; the CLI validates each component.

## Deploy with Boreal

The easiest way to deploy to production with MooseStack is to use [Boreal](https://www.fiveonefour.com/boreal) from Fiveonefour, the creators of MooseStack. Boreal provides github integration for CI/CD and one click deploys, cloud previews of your dev branches, managed or BYO infrastructure, and security + observability. Boreal works natively with ClickHouse Cloud and RedPanda Cloud.

[Get started with Boreal →](https://www.fiveonefour.com/boreal)

## Deploy Yourself

MooseStack is open source, and apps built with MooseStack can be self-hosted. For detailed self-hosting instructions, see our [deployment documentation](https://docs.fiveonefour.com/moose/deploying).

## Docs

- [Overview](https://docs.fiveonefour.com/moose)
- [5-min Quickstart](https://docs.fiveonefour.com/moose/getting-started/quickstart)
- [Quickstart with Existing Clickhouse](https://docs.fiveonefour.com/moose/getting-started/from-clickhouse)

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

We welcome contributions! See the [contribution guidelines](https://github.com/514-labs/moose/blob/main/CONTRIBUTING.md).

## License

MooseStack is open source software and MIT licensed.
