# CDP Analytics Project Guide

A Customer Data Platform demo that tracks customer journeys from acquisition through conversion, with AI-powered data exploration.

## Architecture

```
packages/
├── moosestack-service/          # Backend (port 4000)
│   └── app/
│       ├── ingest/models.ts     # 6 data models
│       ├── apis/                # REST + MCP endpoints
│       └── workflows/           # Batch, scheduled, webhook ingestion
└── web-app/                     # Frontend (port 3000)
    └── src/
        ├── features/dashboard/  # Visualization components
        └── features/chat/       # AI chat interface
```

## Quick Start

```bash
pnpm install
pnpm dev                    # Both services
pnpm dev:moose              # Backend only
pnpm dev:web                # Frontend only

# Generate demo data (10k customers, realistic funnels)
cd packages/moosestack-service && pnpm generate-mock-data
```

## Data Models

Defined in `packages/moosestack-service/app/ingest/models.ts`. Compatible with GA4, Segment, Meta CAPI, and Square.

| Model | Key Fields | Source Compatibility |
|-------|------------|---------------------|
| **Customer** | customerId, email, acquisitionChannel, lifetimeValue, customerTier | Segment Identify, Square Customers |
| **Event** | eventId, eventType, customerId, pageUrl, utmSource/Medium/Campaign | GA4 Events, Segment Track, Meta Pixel |
| **Session** | sessionId, durationSeconds, hasConversion, trafficSource | GA4 Sessions |
| **Transaction** | transactionId, totalAmount, status, isFirstPurchase | Square Orders, GA4 Purchase |
| **TransactionItem** | itemId, productSku, quantity, lineTotal | Square Line Items |
| **Product** | productSku, productName, price, category | Product Catalog |

## Data Ingestion Patterns

Four ways to get data into the platform:

| Pattern | Implementation | Command |
|---------|---------------|---------|
| **REST API** | POST to `/ingest/{Model}` | `curl -X POST localhost:4000/ingest/Event -d '{...}'` |
| **Batch Import** | `app/workflows/batch-import.ts` | `pnpm dev:batch-import '{"csvPath": "..."}'` |
| **Scheduled Sync** | `app/workflows/scheduled-sync.ts` | Runs every 5 min automatically |
| **Webhook** | `app/apis/segment-webhook.ts` | POST to `/segment/webhook` |

## API Endpoints

### Analytics API (`/analytics`)

| Endpoint | Description |
|----------|-------------|
| `GET /funnel` | Email journey: Sent → Opened → Clicked → Signed Up |
| `GET /metrics` | KPIs: emailsSent, openRate, clickRate, signups |
| `GET /cohorts` | Weekly cohorts with Entered → Engaged → Active → Converted |
| `GET /conversion-trend` | 8-week conversion sparkline |
| `GET /segments/campaigns` | Signups by campaign |
| `GET /segments/devices` | Clicks by device type |

### MCP Tools (`/tools`)

| Tool | Purpose |
|------|---------|
| `query_clickhouse` | Execute read-only SQL (max 1000 rows) |
| `get_data_catalog` | Discover tables and schemas |

## Extending the App

### API Architecture Pattern

**Always separate routing from business logic.** APIs should follow this structure:

```
app/
├── apis/analytics.ts           # Routes only (~10 lines per endpoint)
├── services/analyticsService.ts # Business logic (testable functions)
├── services/clickhouseService.ts # DB query helper
└── types/analytics.ts          # Shared type definitions
```

**Route files** should be thin - just HTTP handling:
```ts
// apis/analytics.ts
app.get("/your-endpoint", async (req, res) => {
  try {
    const data = await getYourData();  // Call service function
    res.json(data);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});
```

**Service files** contain all business logic:
```ts
// services/analyticsService.ts
export async function getYourData(): Promise<YourType[]> {
  const rows = await executeQuery<RawRow>(`SELECT ... FROM ...`);
  return rows.map(row => transformRow(row));  // Transform, calculate, etc.
}
```

**Type files** define shared interfaces:
```ts
// types/analytics.ts
export interface YourType {
  field1: string;
  field2: number;
}
```

### Add a New Journey/Funnel

1. **Add types** in `packages/moosestack-service/app/types/analytics.ts`:
   ```ts
   export interface YourJourneyStage {
     stage: string;
     count: number;
     rate: string;
   }
   ```

2. **Add service function** in `packages/moosestack-service/app/services/analyticsService.ts`:
   ```ts
   export async function getYourJourneyData(): Promise<YourJourneyStage[]> {
     const rows = await executeQuery<{ stage1: string; stage2: string }>(`
       SELECT
         countIf(stage1_condition) as stage1,
         countIf(stage2_condition) as stage2
       FROM Event WHERE ...
     `);
     // Transform and return
     return [
       { stage: "Stage 1", count: parseInt(rows[0].stage1), rate: "100%" },
       // ...
     ];
   }
   ```

3. **Add route** in `packages/moosestack-service/app/apis/analytics.ts`:
   ```ts
   app.get("/your-journey", async (req, res) => {
     try {
       const data = await getYourJourneyData();
       res.json(data);
     } catch (error) {
       console.error("Error:", error);
       res.status(500).json({ error: "Failed to fetch data" });
     }
   });
   ```

4. **Create visualization** in `packages/web-app/src/features/dashboard/your-journey.tsx`

5. **Add to page** in `packages/web-app/src/app/page.tsx`

### Add a New Data Source

**Option A: Webhook receiver** (real-time)
```ts
// packages/moosestack-service/app/apis/your-webhook.ts
import express from "express";
import { WebApp } from "@514labs/moose-lib";

const app = express();
app.use(express.json());

// Transform external format to your model
function transformToCustomer(externalData: any): Customer {
  return {
    customerId: externalData.id,
    email: externalData.email,
    createdAt: new Date(externalData.created_at),
    // ... map other fields
  };
}

app.post("/webhook", async (req, res) => {
  try {
    const data = req.body;
    const transformed = transformToCustomer(data);

    // Ingest into your model
    await fetch("http://localhost:4000/ingest/Customer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(transformed),
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).json({ error: "Failed to process webhook" });
  }
});

export const yourWebhook = new WebApp("yourWebhook", app, {
  mountPath: "/your-source",
  metadata: { description: "Webhook receiver for YourSource" }
});
```

**Option B: Scheduled sync** (polling external APIs)
```ts
// packages/moosestack-service/app/workflows/your-sync.ts
import { Task, Workflow, getTable } from "@514labs/moose-lib";

interface SyncInput {
  since?: string;  // Optional: sync from timestamp
}

interface SyncResult {
  synced: number;
  errors: number;
}

export const yourSyncTask = new Task<SyncInput, SyncResult>("your-sync-task", {
  run: async (ctx) => {
    // Fetch from external API
    const response = await fetch("https://api.external-service.com/data", {
      headers: { "Authorization": `Bearer ${process.env.EXTERNAL_API_KEY}` }
    });
    const externalData = await response.json();

    // Transform and insert
    const table = getTable("YourModel");
    const transformed = externalData.map(item => ({
      id: item.id,
      value: item.value,
      timestamp: new Date(item.timestamp),
    }));

    await table.insert(transformed);

    return { synced: transformed.length, errors: 0 };
  },
});

export const yourSyncWorkflow = new Workflow("your-sync-workflow", {
  startingTask: yourSyncTask,
  schedule: "0 * * * *", // Cron: every hour. Use "*/5 * * * *" for every 5 min
});
```

Then export in `app/index.ts`:
```ts
export { yourSyncWorkflow } from "./workflows/your-sync";
```

### Add a Materialized View

Materialized views pre-aggregate data for fast dashboard queries. Use them when:
- Dashboard queries are slow (>500ms)
- You're aggregating across multiple tables
- You need cohort-based breakdowns

```ts
// packages/moosestack-service/app/views/your-metrics.ts
import { View, getTable } from "@514labs/moose-lib";

// Define the aggregated output schema
export interface YourMetrics {
  dimension: string;      // e.g., cohortWeek, channel, campaign
  metricA: number;        // e.g., count, sum
  metricB: number;
  metricC: number;
}

// Reference your source table
const sourceTable = getTable("YourModel");

export const yourMetricsView = new View<YourMetrics>({
  tableName: "YourMetrics_MV",
  materializedFrom: {
    fromTables: [sourceTable],
    // SQL query that aggregates data
    query: `
      SELECT
        toStartOfWeek(timestamp) as dimension,
        count() as metricA,
        sum(value) as metricB,
        countIf(condition = true) as metricC
      FROM ${sourceTable.name}
      GROUP BY dimension
    `,
  },
  // SummingMergeTree allows incremental updates
  tableCreateOptions: {
    engine: "SummingMergeTree",
    orderBy: "dimension",
  },
});
```

Then export in `app/index.ts`:
```ts
export { yourMetricsView } from "./views/your-metrics";
```

**Querying the MV** (in your service):
```ts
// Note: SummingMergeTree requires SUM() to merge partial rows
const rows = await executeQuery(`
  SELECT
    dimension,
    sum(metricA) as metricA,
    sum(metricB) as metricB
  FROM YourMetrics_MV
  GROUP BY dimension
  ORDER BY dimension DESC
`);
```

### Add a New Data Model

```ts
// packages/moosestack-service/app/ingest/models.ts
export interface YourModel {
  yourId: Key<string>;
  field1: string;
  field2: number;
  timestamp: Date;
}

export const YourModelPipeline = new IngestPipeline<YourModel>("YourModel", {
  table: true,
  stream: true,
  ingestApi: true,
});
```

Then export in `app/index.ts`. This auto-creates:
- ClickHouse table
- `/ingest/YourModel` endpoint
- Streaming support

### Add a New AI Tool

```ts
// packages/moosestack-service/app/apis/mcp.ts
server.tool(
  "your_tool",
  "Description of what this tool does",
  { param1: z.string().describe("Parameter description") },
  { title: "Your Tool" },
  async ({ param1 }) => {
    const result = await doSomething(param1);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);
```

### Add a New Dashboard Component

```tsx
// packages/web-app/src/features/dashboard/your-component.tsx
export function YourComponent() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetchApi(analyticsApi.yourEndpoint)
      .then(setData)
      .catch(() => setData(fallbackData));
  }, []);

  return (
    <Card>
      <CardHeader><CardTitle>Your Title</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer>
          <BarChart data={data}>...</BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
```

Add URL to `packages/web-app/src/lib/api.ts`:
```ts
export const analyticsApi = {
  yourEndpoint: `${API_BASE}/analytics/your-endpoint`,
};
```

## Key Files Reference

| File | Purpose |
|------|---------|
| `moosestack-service/app/ingest/models.ts` | All 6 data models with field mappings |
| `moosestack-service/app/apis/analytics.ts` | Dashboard API routes (thin, calls services) |
| `moosestack-service/app/services/analyticsService.ts` | Analytics business logic |
| `moosestack-service/app/services/clickhouseService.ts` | ClickHouse query helper |
| `moosestack-service/app/types/analytics.ts` | Shared API response types |
| `moosestack-service/app/apis/mcp.ts` | MCP server + AI tools |
| `moosestack-service/app/apis/segment-webhook.ts` | Segment event transformer |
| `web-app/src/features/dashboard/cohort-journey.tsx` | Main cohort visualization |
| `web-app/src/features/chat/agent-config.ts` | MCP client setup |
| `web-app/src/app/page.tsx` | Dashboard layout |

## Tech Stack

- **Backend**: MooseStack, Express 5, ClickHouse, Redpanda
- **Frontend**: Next.js 16, React 19, Recharts, Radix UI, TailwindCSS 4
- **AI**: Claude Haiku, AI SDK, MCP Protocol

## Deployment

- **Backend**: Push to GitHub → Deploy on [Boreal](https://boreal.cloud)
- **Frontend**: Push to GitHub → Deploy on Vercel
- Set `NEXT_PUBLIC_API_URL` to your Boreal backend URL
