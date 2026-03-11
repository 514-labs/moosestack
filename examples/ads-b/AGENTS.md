# ADS-B Template

Real-time aircraft transponder data pipeline.

## Dev Server

Start with: `moose dev`

Ports used: 4000, 5001, 7233, 8080, 9000, 18123. See `moose.config.toml` to change.

## Key Files

| File | Purpose |
| --- | --- |
| `app/datamodels/models.ts` | Data models (aircraft transponder data) |
| `app/functions/process_aircraft.ts` | Aircraft data processing logic |
| `app/scripts/1.fetch_and_ingest_military_aircraft.ts` | Data fetching and ingestion scripts |
| `moose.config.toml` | Port and service configuration |

## Dev Environment

### Start the dev server

This starts ClickHouse, the data pipeline, and the MooseDev MCP server on `localhost:4000`.

### MooseDev MCP (live project inspection)

Pre-configured in `.mcp.json`. Prefer these over CLI commands — they return structured, token-optimized output.

| Tool | When to use |
| --- | --- |
| `get_infra_map` | **Start here.** Understand project topology (tables, streams, APIs, workflows) and data flow |
| `query_olap` | Explore data, verify ingestion, check schemas (read-only SQL) |
| `get_logs` | Debug errors, connection issues, or unexpected behavior |
| `get_issues` | Diagnose infrastructure health (stuck mutations, replication errors) |
| `get_stream_sample` | Inspect recent messages from streaming topics to verify data flow |

### Context7

Pre-configured in `.mcp.json`. Add "use context7" to your prompts when you need MooseStack documentation.

### ClickHouse Best Practices Skill (optional)

Not included by default. Install with `514 agent init` to get rules for schema design, query optimization, insert strategy, and MooseStack-specific patterns.

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

## Common Patterns

### Adding a data model

MooseStack's core pattern: define a TypeScript interface once, then configure an `IngestPipeline` to create your data pipeline.

```typescript
import { IngestPipeline } from "@514labs/moose-lib";

export interface PageView {
  viewId: string;
  timestamp: Date;
  url: string;
  userId: string;
  durationMs: number;
}

export const PageViewPipeline = new IngestPipeline<PageView>("PageView", {
  table: { orderByFields: ["userId", "timestamp"] },
  stream: true,
  ingestApi: true,
});
```

The `table` field accepts either a boolean (`true` for defaults, `false` to skip table creation) or an object with `orderByFields` for explicit ordering. Use `orderByFields` when you need control over ClickHouse table ordering (put your most-filtered columns first). If you have the ClickHouse Best Practices Skill installed, use it to choose the right ordering.

For advanced table configuration (engines, indexes, projections), see `moose docs moosestack/olap/model-table`.

### Do / Don't

- **DO** specify `orderByFields` for production tables. **DON'T** rely on default ordering for performance-sensitive queries — specify based on query patterns.
- **DO** use `currentDatabase()` in SQL queries. **DON'T** hardcode the database name.
- **DO** use `IngestPipeline` for new data models. **DON'T** write raw CREATE TABLE DDL — MooseStack generates tables from your models.
- **DO** use the ClickHouse Best Practices Skill (if installed) for schema decisions. **DON'T** guess at ClickHouse data types or engine choices.
- **DO** export new primitives from your app's entry file (`app/index.ts`). **DON'T** forget to export — MooseStack won't discover unexported primitives.
