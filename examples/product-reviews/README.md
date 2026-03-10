# Product Reviews Analytics

> Explore 25M Amazon reviews through a semantic query model — one definition powers REST APIs, MCP tools, and AI chat.

| | |
|---|---|
| **Moose Features** | Query Layer (`defineQueryModel`), MCP Integration, REST APIs (Express), Schema-Driven Query Builder UI |
| **Data Source** | Amazon Customer Reviews dataset (~25M rows, loaded from S3) |
| **Stack** | MooseStack + Next.js + ClickHouse |
| **Difficulty** | Beginner |

## What This Demonstrates

**One query model powers three interfaces:**

```
defineQueryModel(reviewMetrics)
    ├── buildQuery()         → REST API  → Dashboard charts + Query Builder UI
    ├── registerModelTools() → MCP tool  → AI chat (Claude)
    └── createModelTool()    → AI SDK    → (available for custom integrations)
```

- **`app/query-models/review-metrics.ts`** — Single source of truth for 12 metrics, 7 dimensions, 8 filters
- **`app/apis/reviews.ts`** — `/reviews/schema` and `/reviews/metrics` REST endpoints powered by `buildQuery()`
- **`app/apis/mcp.ts`** — `query_review_metrics` MCP tool auto-registered via `registerModelTools()`
- **Query Builder UI** — Schema-driven frontend that dynamically renders metric/dimension/filter chips from the `/reviews/schema` endpoint

Adding a metric or filter to `reviewMetrics` automatically appears in all three interfaces — no other files need updating.

## Quick Start

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| **Node.js** | v20+ | [nodejs.org](https://nodejs.org/) |
| **pnpm** | v8+ | `npm install -g pnpm` |
| **Docker** | v20+ | [docker.com](https://www.docker.com/get-started/) - must be running |
| **Moose CLI** | latest | `bash -i <(curl -fsSL https://fiveonefour.com/install.sh) moose` |

For the AI chat feature, you'll also need an [Anthropic API key](https://console.anthropic.com/).

### 1. Clone and Install

```bash
git clone --depth 1 https://github.com/514-labs/moose.git
cd moose/examples/product-reviews

pnpm install
```

### 2. Configure Environment

```bash
cp packages/moosestack-service/.env.{example,local}
cp packages/web-app/.env.{example,local}
```

Generate API authentication tokens:

```bash
cd packages/moosestack-service
moose generate hash-token
```

Set environment variables using the output:

| Variable | File | Value |
| --- | --- | --- |
| `MCP_API_KEY` | `packages/moosestack-service/.env.local` | `ENV API Key` (hash) |
| `MCP_API_TOKEN` | `packages/web-app/.env.local` | `Bearer Token` |
| `ANTHROPIC_API_KEY` | `packages/web-app/.env.local` | Your [Anthropic API key](https://console.anthropic.com/) |

### 3. Run

```bash
pnpm dev
```

This starts both the MooseStack backend (port 4000) and the Next.js frontend (port 3000).

## Load Sample Data

With the dev server running, load the Amazon Customer Reviews dataset from S3:

```bash
moose query "
INSERT INTO local.AmazonReview
SELECT * FROM s3(
  'https://datasets-documentation.s3.eu-west-3.amazonaws.com/amazon_reviews/amazon_reviews_2015.snappy.parquet',
  'Parquet'
);
"
```

Verify the data loaded:

```bash
moose query "SELECT count() FROM AmazonReview"
# Expected: ~25.4 million rows
```

## Explore

| URL | What it is |
| --- | --- |
| `http://localhost:3000` | Dashboard with review charts |
| `http://localhost:3000/builder` | Interactive query builder |
| Chat panel (bottom-right) | AI chat powered by the same query model |
| `http://localhost:4000/reviews/schema` | Query model schema (JSON) |
| `http://localhost:4000/reviews/metrics?metrics=totalReviews,avgRating&dimensions=product_category` | REST query |

## Key Files

| File | Role |
| --- | --- |
| `packages/moosestack-service/app/ingest/models.ts` | Data model (`AmazonReview` interface + `OlapTable`) |
| `packages/moosestack-service/app/query-models/review-metrics.ts` | Semantic query model (`defineQueryModel`) |
| `packages/moosestack-service/app/apis/reviews.ts` | REST endpoints (`/reviews/schema`, `/reviews/metrics`) |
| `packages/moosestack-service/app/apis/mcp.ts` | MCP server with `registerModelTools()` |
| `packages/web-app/src/components/report-builder/` | Query builder UI (schema-driven) |
| `packages/web-app/src/features/dashboard/review-charts.tsx` | Dashboard charts |

## Learn More

- [Query Layer Reference](https://docs.fiveonefour.com/moosestack/reference/query-layer)
- [Semantic Layer Guide](https://docs.fiveonefour.com/moosestack/apis/semantic-layer)
- [Chat in Your App Tutorial](https://docs.fiveonefour.com/guides/chat-in-your-app/tutorial)
- [MooseStack Documentation](https://docs.fiveonefour.com)
