# Military Aircraft Tracker

> Live ADS-B transponder tracking with one query model powering REST APIs, MCP tools, and AI chat.

| | |
|---|---|
| **Moose Features** | Query Layer (`defineQueryModel`), MCP Integration, REST APIs (Express), Live Data Connector, Temporal Workflows |
| **Data Source** | Live military ADS-B transponder feeds ([adsb.lol/v2/mil](https://api.adsb.lol/v2/mil), polled every 30s) |
| **Stack** | MooseStack + Next.js + ClickHouse |
| **Difficulty** | Intermediate |

A live military aircraft tracking app that demonstrates MooseStack's **semantic query layer**. One `defineQueryModel` definition powers the REST API, MCP tools, and AI chat — same metrics, same SQL, consistent answers everywhere.

## Quick Start

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| **Node.js** | v20+ | [nodejs.org](https://nodejs.org/) |
| **pnpm** | v8+ | `npm install -g pnpm` |
| **Docker** | v20+ | [docker.com](https://www.docker.com/get-started/) - must be running |
| **Moose CLI** | latest | see below |

For the AI chat feature, you'll also need an [Anthropic API key](https://console.anthropic.com/).

Install MooseStack (and optionally the 514 hosting) CLIs:

```bash
bash -i <(curl -fsSL https://fiveonefour.com/install.sh) moose,514
```

### 1. Clone and Install

```bash
git clone --depth 1 https://github.com/514-labs/moose.git
cd moose/examples/aircraft-tracker

pnpm install
```

### 2. Configure Environment

```bash
cp packages/moosestack-service/.env.{example,local}
cp packages/web-app/.env.{example,local}
```

Generate an API key pair:

```bash
cd packages/moosestack-service
moose generate hash-token
```

| Variable | File | Value |
|----------|------|-------|
| `MCP_API_KEY` | `packages/moosestack-service/.env.local` | Hash from `moose generate hash-token` |
| `MCP_API_TOKEN` | `packages/web-app/.env.local` | Bearer token from `moose generate hash-token` |
| `ANTHROPIC_API_KEY` | `packages/web-app/.env.local` | Your Anthropic API key |

### 3. Start the backend

```bash
pnpm dev:moose
```

Starts ClickHouse, Redpanda, Temporal, and the MooseStack dev server on port 4000. The aircraft connector begins polling [adsb.lol/v2/mil](https://api.adsb.lol/v2/mil) every 30 seconds.

### 4. Start the frontend

```bash
pnpm dev:web
```

Opens on [localhost:3000](http://localhost:3000) with a live dashboard and AI chat.

### 5. Set Up Agent Skills (optional)

If you want to use MooseStack skills with your AI copilot, bootstrap them with:

```bash
514 agent init
```

This installs the following skills:

- **ClickHouse Best Practices** — Schema design, query optimization, and insert strategy rules with MooseStack-specific examples
- **514 CLI** — Interact with the 514 platform (login, link project, check deployments, browse docs)
- **514 Debug** — Debug 514 deployments (check status, tail logs, find slow queries, run diagnostics)
- **514 Perf Optimize** — Guided ClickHouse performance optimization workflow with benchmarking

If you start your copilot now, you will have the MooseStack Skills, LSP, and MCPs up and running.

### Ports

| Service | Port |
|---------|------|
| Next.js web app | 3000 |
| MooseStack HTTP/MCP | 4000 |
| Management API | 5001 |
| Temporal | 7233 |
| Temporal UI | 8080 |
| ClickHouse HTTP | 18123 |
| ClickHouse native | 9000 |

## How the Query Model Works

The core of this demo is a single file: [`app/query-models/aircraft-metrics.ts`](packages/moosestack-service/app/query-models/aircraft-metrics.ts).

It uses `defineQueryModel` to declare metrics, dimensions, filters, and defaults in one place:

```typescript
export const aircraftMetrics = defineQueryModel({
  name: "query_aircraft_metrics",
  table: AircraftTrackingProcessedTable,

  metrics: {
    totalAircraft: { agg: countDistinct(table.columns.hex) },
    planesInAir:   { agg: sql`countDistinct(CASE WHEN alt_baro_is_ground = false THEN hex END)` },
    planesOnGround: { ... },
    avgGroundSpeed: { ... },
    // ...8 metrics total
  },

  dimensions: {
    aircraftType: { column: "aircraft_type" },
    day:          { expression: sql`toDate(timestamp)`, as: "day" },
    hour:         { expression: sql`toStartOfHour(timestamp)`, as: "hour" },
    // ...
  },

  filters: {
    aircraftType: { column: "aircraft_type", operators: ["eq", "in"] },
    timestamp:    { column: "timestamp", operators: ["gte", "lte"] },
  },
});
```

This one definition is consumed three ways:

| Consumer | Code | File |
|----------|------|------|
| **REST API** | `buildQuery(aircraftMetrics).metrics([...]).execute(client)` | [`app/apis/aircraft.ts`](packages/moosestack-service/app/apis/aircraft.ts) |
| **MCP Tool** | `registerModelTools(server, [aircraftMetrics], client)` | [`app/apis/mcp.ts`](packages/moosestack-service/app/apis/mcp.ts) |
| **AI Chat** | The LLM calls the registered `query_aircraft_metrics` MCP tool | [`packages/web-app`](packages/web-app) |

### Example API calls

```bash
# Default summary: total, in-air, on-ground
curl "localhost:4000/aircraft/metrics"

# All metrics
curl "localhost:4000/aircraft/metrics?metrics=totalAircraft,planesInAir,planesOnGround,avgGroundSpeed,avgAltitude,emergencyCount"

# Grouped by aircraft type
curl "localhost:4000/aircraft/metrics?metrics=totalAircraft,planesInAir&dimensions=aircraftType&limit=10"

# Grouped by day
curl "localhost:4000/aircraft/metrics?metrics=totalAircraft&dimensions=day"
```

## Why Not Just Write SQL?

See [`SQL_AUDIT.md`](SQL_AUDIT.md) for a documented example of what goes wrong without a shared query model.

When the API, MCP tool, and LLM each write their own SQL:

- The **hand-written API** used `count(DISTINCT hex)` with a 2-minute rolling window
- The **LLM** generated `SUM(CASE ...)` against a different table with a latest-timestamp filter
- Same question ("how many planes are in the air?"), **different answers**

The problems compound:
- **Different time windows** — rolling 2-minute vs. latest snapshot
- **Different tables** — processed table vs. raw table
- **Different deduplication** — `COUNT(DISTINCT hex)` vs. `SUM(CASE ...)` counting rows

The query model eliminates all of this. The SQL is generated from the model definition, so every consumer gets the same aggregations, the same table, and the same semantics.

## Project Structure

```
packages/moosestack-service/
  app/
    datamodels/models.ts          # AircraftTrackingData + Processed interfaces (40+ fields, full JSDoc)
    ingest/aircraft.ts            # OlapTables, Streams, IngestApi, DLQ, transform pipeline
    query-models/aircraft-metrics.ts  # <-- THE QUERY MODEL (single source of truth)
    apis/aircraft.ts              # REST API using buildQuery()
    apis/mcp.ts                   # MCP server using registerModelTools()
    connectors/                   # Workflow polling adsb.lol every 30s
    index.ts                      # Exports all primitives

packages/web-app/
  src/
    components/active-aircraft-widget.tsx  # Live dashboard widget (6 metrics, 30s refresh)
    app/api/aircraft/active-count/        # Next.js proxy to backend API
```

## Connecting External MCP Clients

The MCP server at `/tools` exposes `query_aircraft_metrics`, `query_clickhouse`, and `get_data_catalog`.

### Claude Code

```bash
claude mcp add --transport http moose-tools http://localhost:4000/tools --header "Authorization: Bearer <your_bearer_token>"
```

### Other clients (mcp.json)

```json
{
  "mcpServers": {
    "moose-tools": {
      "transport": "http",
      "url": "http://localhost:4000/tools",
      "headers": {
        "Authorization": "Bearer <your_bearer_token>"
      }
    }
  }
}
```

## Docs

- [MooseStack Semantic Layer](https://docs.fiveonefour.com/moosestack/apis/semantic-layer)
- [Data Modeling](https://docs.fiveonefour.com/moosestack/data-modeling)
- [BYO API with Express](https://docs.fiveonefour.com/moosestack/app-api-frameworks/express)
- [Chat in Your App Tutorial](https://docs.fiveonefour.com/guides/chat-in-your-app/tutorial)
- [MooseDev MCP](https://docs.fiveonefour.com/moosestack/moosedev-mcp)
