# TypeScript Empty Template

Empty MooseStack app — a blank canvas for building your analytical backend.

## Pre-Development Steps

### 1. Check local environment

- Verify ports 4000, 5001, 7233, 8080, 9000, and 18123 are free. See `moose.config.toml` to change them if needed.
- The project must be initialized (`moose init`) and dependencies installed (`npm install`).

### 2. Clarify requirements with the user

Before building data models or tools, ask the user:

- What data they want to model (fields, sources, volume)
- How the data will be queried (what questions will users ask, what filters matter most)
- How the data will be consumed (dashboards, API endpoints, chat interface)
- Whether ingestion is real-time streaming or batch

The user knows their data and use case; use the ClickHouse Best Practices Skill to translate their requirements into optimal schemas, `orderByFields`, and queries.

### 3. Set up agent harness

Ensure all of these are active before starting work.

1. **Dev server running** — Start with `npm run dev`. This powers ClickHouse, the data pipeline, and the MooseDev MCP server.

2. **MooseDev MCP connected** — Pre-configured in `.mcp.json`. Verify it is connected in your copilot. This is your primary tool for inspecting the project.

3. **Context7 connected** — Pre-configured in `.mcp.json`. Add "use context7" to your prompts when you need MooseStack documentation.

4. **ClickHouse Best Practices Skill installed** — Install at the start of every session if not already present:

   ```bash
   npx skills add https://github.com/514-labs/agent-skills --skill moosestack-clickhouse-best-practices
   ```

## Key Files

| File | Purpose |
| --- | --- |
| `app/index.ts` | **Barrel export file — all primitives (tables, streams, pipelines, APIs, views, workflows) must be exported here or MooseStack won't discover them** |
| `moose.config.toml` | Port and service configuration |

## Common Tasks

### Adding a data model

MooseStack's `IngestPipeline` bundles a table, stream, and ingest API from a single interface:

```typescript
// app/ingest/models.ts
import { IngestPipeline, Key, DateTime } from "@514labs/moose-lib";

export interface PageView {
  viewId: Key<string>;
  timestamp: DateTime;
  url: string;
  userId: string;
  durationMs: number;
}

export const PageViewPipeline = new IngestPipeline<PageView>("PageView", {
  table: true,    // Persist in ClickHouse
  stream: true,   // Buffer for transforms
  ingestApi: true, // POST /ingest/PageView
});
```

Then add the export to `app/index.ts`:

```typescript
export * from "./ingest/models";
```

For more control, use individual primitives (`OlapTable`, `Stream`, `IngestApi`) instead of `IngestPipeline`. See `moose docs moosestack/olap/model-table` for advanced table configuration (engines, indexes, projections).

### Adding a transform

Wire a transform between two streams to process data in flight:

```typescript
// app/ingest/transforms.ts
import { SourcePipeline, DestPipeline, SourceType, DestType } from "./models";

SourcePipeline.stream!.addTransform(
  DestPipeline.stream!,
  async (source: SourceType): Promise<DestType> => {
    return {
      // ... transform fields
    };
  },
);
```

Then add the export to `app/index.ts`:

```typescript
export * from "./ingest/transforms";
```

### Adding a materialized view

Pre-aggregate data in ClickHouse for fast queries:

```typescript
// app/views/myView.ts
import { MaterializedView, sql } from "@514labs/moose-lib";
import { MyPipeline } from "../ingest/models";

const table = MyPipeline.table!;

export const MyMV = new MaterializedView<MyAggregated>({
  tableName: "MyAggregated",
  materializedViewName: "MyAggregated_MV",
  orderByFields: ["groupingField"],
  selectStatement: sql.statement`SELECT ... FROM ${table} GROUP BY ...`,
  selectTables: [table],
});
```

### Adding an API endpoint

Use the `Api` primitive for typed consumption APIs:

```typescript
// app/apis/myApi.ts
import { Api } from "@514labs/moose-lib";

interface QueryParams {
  limit?: number;
}

interface ResponseRow {
  name: string;
  count: number;
}

export const MyApi = new Api<QueryParams, ResponseRow[]>(
  "my-endpoint",
  async ({ limit = 10 }, { client, sql }) => {
    const query = sql.statement`
      SELECT name, count() as count
      FROM MyTable
      ORDER BY count DESC
      LIMIT ${limit}
    `;
    const data = await client.query.execute<ResponseRow>(query);
    return await data.json();
  },
);
```

Key patterns:

- Use `sql.statement` for complete SQL queries and `sql.fragment` for reusable SQL expressions (prevents injection)
- Use `currentDatabase()` in SQL instead of hardcoding the database name
- Export the `Api` from the file and re-export from `app/index.ts`

### Adding a workflow

Use workflows for scheduled or multi-step data processing:

```typescript
// app/workflows/myWorkflow.ts
import { Task, Workflow } from "@514labs/moose-lib";

const myTask = new Task<null, number>("myTask", {
  run: async () => {
    // ... do work
    return 42;
  },
  retries: 3,
  timeout: "30s",
});

export const myWorkflow = new Workflow("myWorkflow", {
  startingTask: myTask,
  retries: 3,
  timeout: "30s",
  // schedule: "@every 5m",  // Uncomment to run on a schedule
});
```

### Do / Don't

- **DO** export new primitives from `app/index.ts`. **DON'T** forget to export — MooseStack won't discover unexported primitives.
- **DO** use `orderByFields` to define ClickHouse table ordering. **DON'T** rely on default ordering — always specify based on query patterns.
- **DO** use `currentDatabase()` in SQL queries. **DON'T** hardcode the database name.
- **DO** use `IngestPipeline` or `OlapTable` + `Stream` + `IngestApi` for new data models. **DON'T** write raw CREATE TABLE DDL — MooseStack generates tables from your models.
- **DO** use `sql.statement` / `sql.fragment` for queries. **DON'T** use string interpolation for SQL — it's vulnerable to injection.
- **DO** use the ClickHouse Best Practices Skill for schema decisions. **DON'T** guess at ClickHouse data types or engine choices.

## Available Tools

### MooseDev MCP (live project inspection)

Prefer these over CLI commands — they return structured, token-optimized output.

| Tool | When to use |
| --- | --- |
| `get_infra_map` | **Start here.** Understand project topology (tables, streams, APIs, workflows) and data flow |
| `query_olap` | Explore data, verify ingestion, check schemas (read-only SQL) |
| `get_logs` | Debug errors, connection issues, or unexpected behavior |
| `get_issues` | Diagnose infrastructure health (stuck mutations, replication errors) |
| `get_stream_sample` | Inspect recent messages from streaming topics to verify data flow |

### ClickHouse Best Practices Skill

Use when creating or refining data models, writing ClickHouse queries, designing schemas, or configuring materialized views. Contains rules for schema design, query optimization, insert strategy, and MooseStack-specific patterns.

### Moose CLI

Use `moose --help` to discover all commands. Most useful for getting context:

| Command | Purpose |
| --- | --- |
| `moose docs <slug>` | Fetch documentation (e.g., `moose docs moosestack/olap`) |
| `moose docs search "query"` | Search documentation by keyword |
| `moose query "SQL"` | Execute SQL directly against ClickHouse |
| `moose ls` | List all project primitives (tables, streams, APIs, workflows) |
| `moose peek <name>` | View sample data from a table or stream |
| `moose logs` | View dev server logs (use `-f "error"` to filter) |

## Documentation

- [Quickstart](https://docs.fiveonefour.com/moosestack/getting-started/quickstart)
- [Data Modeling](https://docs.fiveonefour.com/moosestack/data-modeling)
- [OlapTable](https://docs.fiveonefour.com/moosestack/olap/model-table)
- [Materialized Views](https://docs.fiveonefour.com/moosestack/olap/materialized-view)
- [Streams & Transforms](https://docs.fiveonefour.com/moosestack/streaming)
- [Consumption APIs](https://docs.fiveonefour.com/moosestack/consumption-apis)
- [Workflows](https://docs.fiveonefour.com/moosestack/workflows)
- [MooseDev MCP](https://docs.fiveonefour.com/moosestack/moosedev-mcp)
- [Data Types](https://docs.fiveonefour.com/moosestack/data-types)
