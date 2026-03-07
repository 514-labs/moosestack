# TypeScript Empty Template

Empty MooseStack app — a blank canvas for building your analytical backend.

## Pre-Development Steps

### 1. Check local environment

- Verify ports 4000, 5001, 7233, 8080, 9000, and 18123 are free. See `moose.config.toml` to change them if needed. If you change MooseDev's port from `4000`, update `.mcp.json` (`mcpServers.moose-dev.url`) to match.
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
| `app/index.ts` | **Barrel export file — all primitives (tables, streams, ingest APIs, query APIs, views, workflows) must be exported here or MooseStack won't discover them** |
| `moose.config.toml` | Port and service configuration |

## Core Primitives

These are the building blocks you'll use most. Detailed examples below; for all other primitives see the [Documentation](#documentation) links.

### OlapTable

Define ClickHouse tables with type-safe schemas. `orderByFields` controls the ClickHouse primary key — put your most-filtered columns first.

```typescript
// app/models/pageViews.ts
import { OlapTable, Key, DateTime } from "@514labs/moose-lib";

export interface PageView {
  viewId: Key<string>;
  timestamp: DateTime;
  url: string;
  userId: string;
  durationMs: number;
}

export const PageViewTable = new OlapTable<PageView>("PageView", {
  orderByFields: ["userId", "timestamp"],
});
```

Then export from `app/index.ts`:

```typescript
export * from "./models/pageViews";
```

Use the ClickHouse Best Practices Skill to choose the right `orderByFields` for the user's query patterns. For advanced configuration (engines, indexes, projections), see `moose docs moosestack/olap/model-table`.

### MaterializedView

Pre-compute and store aggregated query results in ClickHouse. Runs automatically as data arrives — no cron jobs needed.

```typescript
// app/views/pageViewStats.ts
import { MaterializedView, sql } from "@514labs/moose-lib";
import { PageViewTable } from "../models/pageViews";

interface PageViewStats {
  day: Date;
  totalViews: number;
  uniqueUsers: number;
}

export const PageViewStatsMV = new MaterializedView<PageViewStats>({
  tableName: "PageViewStats",
  materializedViewName: "PageViewStats_MV",
  orderByFields: ["day"],
  selectStatement: sql.statement`
    SELECT
      toDate(${PageViewTable.columns.timestamp}) as day,
      count(${PageViewTable.columns.viewId}) as totalViews,
      uniqExact(${PageViewTable.columns.userId}) as uniqueUsers
    FROM ${PageViewTable}
    GROUP BY day
  `,
  selectTables: [PageViewTable],
});
```

Then export from `app/index.ts`:

```typescript
export * from "./views/pageViewStats";
```

### Semantic Layer (Query Models)

Define a single query model that auto-projects into REST APIs, AI SDK tools, and MCP server tools. This is the primary way to expose data for querying.

```typescript
// app/queries/pageViewMetrics.ts
import { defineQueryModel, sql } from "@514labs/moose-lib";
import { PageViewStatsMV } from "../views/pageViewStats";

export const pageViewMetrics = defineQueryModel({
  table: PageViewStatsMV.targetTable,
  dimensions: {
    day: { column: "day" },
  },
  metrics: {
    totalViews: {
      agg: sql.fragment`sum(${PageViewStatsMV.targetTable.columns.totalViews})`,
    },
    uniqueUsers: {
      agg: sql.fragment`sum(${PageViewStatsMV.targetTable.columns.uniqueUsers})`,
    },
  },
  filters: {
    day: { column: "day", operators: ["eq", "gte", "lte"] as const },
  },
  sortable: ["day", "totalViews", "uniqueUsers"] as const,
  defaults: {
    dimensions: ["day"],
    metrics: ["totalViews"],
    orderBy: [["day", "DESC"]],
    limit: 30,
  },
});
```

Then export from `app/index.ts`:

```typescript
export * from "./queries/pageViewMetrics";
```

Use `buildQuery` for REST APIs, `createModelTool` for AI SDK, or `registerModelTools` for MCP servers — all from the same model definition.

## Other Primitives

Prefer composing `OlapTable` + `Stream` + `IngestApi` for ingestion flows in new code instead of `IngestPipeline`.

| Primitive | Use for | Docs |
| --- | --- | --- |
| `IngestApi` | POST endpoints that validate and route events to streams/tables | [Ingest API](https://docs.fiveonefour.com/moosestack/apis/ingest-api) |
| `Stream` | Standalone streaming topics, transforms, consumers | [Streaming](https://docs.fiveonefour.com/moosestack/streaming) |
| `Api` | Typed GET endpoints for analytics queries | [Analytics API](https://docs.fiveonefour.com/moosestack/apis/analytics-api) |
| `Workflow` / `Task` | Scheduled or multi-step data processing | [Workflows](https://docs.fiveonefour.com/moosestack/workflows) |
| `WebApp` | BYO Express/Fastify/Koa for custom endpoints | [App Frameworks](https://docs.fiveonefour.com/moosestack/app-api-frameworks) |

### Do / Don't

- **DO** export new primitives from `app/index.ts`. **DON'T** forget to export — MooseStack won't discover unexported primitives.
- **DO** use `orderByFields` to define ClickHouse table ordering. **DON'T** rely on default ordering — always specify based on query patterns.
- **DO** use `currentDatabase()` in SQL queries. **DON'T** hardcode the database name.
- **DO** use MooseStack primitives for data models. **DON'T** write raw CREATE TABLE DDL — MooseStack generates tables from your models.
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
- [Materialized Views](https://docs.fiveonefour.com/moosestack/olap/model-materialized-view)
- [Semantic Layer](https://docs.fiveonefour.com/moosestack/apis/semantic-layer)
- [Streams & Transforms](https://docs.fiveonefour.com/moosestack/streaming)
- [Analytics API](https://docs.fiveonefour.com/moosestack/apis/analytics-api)
- [Workflows](https://docs.fiveonefour.com/moosestack/workflows)
- [App API Frameworks](https://docs.fiveonefour.com/moosestack/app-api-frameworks)
- [MooseDev MCP](https://docs.fiveonefour.com/moosestack/moosedev-mcp)
- [Data Types](https://docs.fiveonefour.com/moosestack/data-types)
