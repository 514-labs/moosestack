# Moose Fastify Template

This is a [Moose](https://docs.fiveonefour.com/moose) project using [Fastify](https://fastify.dev/) for serving analytical APIs, bootstrapped with [`moose init`](https://docs.fiveonefour.com/moose/reference/moose-cli#init).

<a href="https://docs.fiveonefour.com/moose/"><img src="https://raw.githubusercontent.com/514-labs/moose/main/logo-m-light.png" alt="moose logo" height="100px"></a>

[![NPM Version](https://img.shields.io/npm/v/%40514labs%2Fmoose-cli?logo=npm)](https://www.npmjs.com/package/@514labs/moose-cli?activeTab=readme)
[![Moose Community](https://img.shields.io/badge/slack-moose_community-purple.svg?logo=slack)](https://join.slack.com/t/moose-community/shared_invite/zt-2fjh5n3wz-cnOmM9Xe9DYAgQrNu8xKxg)
[![Docs](https://img.shields.io/badge/quick_start-docs-blue.svg)](https://docs.fiveonefour.com/moose/getting-started/quickstart)
[![MIT license](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

## About This Template

This template demonstrates how to use **Fastify** with MooseStack's `WebApp` class to build high-performance analytical APIs. It showcases:

- **Fastify WebApp Integration**: Using the `WebApp` class to mount a Fastify application
- **ClickHouse Queries**: Querying materialized views with the Moose SQL client
- **Caching**: Using `MooseCache` for Redis-based response caching
- **Type-safe APIs**: Using the `Api` class with TypeScript types

## Project Structure

```
app/
  apis/
    bar.ts          # Fastify WebApp + Api definitions
  ingest/
    models.ts       # Data models for ingestion
    transforms.ts   # Data transformation functions
  views/
    barAggregated.ts # Materialized view definition
  workflows/
    generator.ts    # Sample data generator workflow
  index.ts          # Main exports
```

## Key Features

### Fastify WebApp

The `bar.ts` file demonstrates mounting a Fastify app at `/fastify`:

```typescript
import Fastify from "fastify";
import { WebApp, getMooseClients, sql } from "@514labs/moose-lib";

const app = Fastify({ logger: true });

app.get("/health", async () => {
  return { status: "ok" };
});

app.get("/query", async (request, reply) => {
  const { client } = await getMooseClients();
  // Query ClickHouse...
});

export const barFastifyApi = new WebApp("barFastify", app, {
  mountPath: "/fastify",
});
```

### Available Endpoints

Once running, the following endpoints are available:

- `GET /fastify/health` - Health check
- `GET /fastify/query?limit=10` - Query aggregated data
- `POST /fastify/data` - Query with filters (JSON body)
- `GET /api/bar` - Type-safe Api endpoint with caching

## Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the dev server:**
   ```bash
   npx moose dev
   ```

3. **Test the endpoints:**
   ```bash
   # Health check
   curl http://localhost:4000/fastify/health

   # Query data
   curl http://localhost:4000/fastify/query?limit=5

   # POST with filters
   curl -X POST http://localhost:4000/fastify/data \
     -H "Content-Type: application/json" \
     -d '{"orderBy": "totalRows", "limit": 5}'
   ```

## Learn More

- [Moose Documentation](https://docs.fiveonefour.com/moose)
- [WebApp Reference](https://docs.fiveonefour.com/moose/building/consumption-apis/web-apps)
- [Fastify Documentation](https://fastify.dev/docs/latest/)
- [Quick Start Tutorial](https://docs.fiveonefour.com/moose/getting-started/quickstart)

## Deploy on Boreal

The easiest way to deploy your MooseStack Applications is to use [Boreal](https://www.fiveonefour.com/boreal) from 514 Labs, the creators of Moose.

Check out our [Moose deployment documentation](https://docs.fiveonefour.com/moose/deploying) for more details.

## Community

Join the Moose community [on Slack](https://join.slack.com/t/moose-community/shared_invite/zt-2fjh5n3wz-cnOmM9Xe9DYAgQrNu8xKxg). Check out the [MooseStack repo on GitHub](https://github.com/514-labs/moosestack).

## Contributing

We welcome contributions to Moose! Please check out the [contribution guidelines](https://github.com/514-labs/moose/blob/main/CONTRIBUTING.md).

## Made by 514

Our mission at [fiveonefour](https://www.fiveonefour.com/) is to bring incredible developer experiences to the data stack. If you're interested in enterprise solutions, commercial support, or design partnerships, we'd love to chat: [hello@moosejs.dev](mailto:hello@moosejs.dev)
