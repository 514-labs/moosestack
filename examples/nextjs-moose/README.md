# Next.js + MooseStack Dashboard

A demo dashboard showing how to integrate [MooseStack](https://docs.fiveonefour.com/moosestack/) with a Next.js application. MooseStack provides a TypeScript-first OLAP modeling and query layer that facilitates management of ClickHouse schema as code and type-safe queries.

## Prerequisites

- Node.js 20+
- pnpm
- Docker Desktop (for local ClickHouse)

## Setup

1. **Install dependencies** (from the monorepo root or this directory):

```bash
pnpm install
```

2. **Configure environment variables** — create `.env.local` in the project root:

```bash
MOOSE_CLIENT_ONLY=true
MOOSE_CLICKHOUSE_CONFIG__DB_NAME=local
MOOSE_CLICKHOUSE_CONFIG__HOST=localhost
MOOSE_CLICKHOUSE_CONFIG__PORT=18123
MOOSE_CLICKHOUSE_CONFIG__USER=panda
MOOSE_CLICKHOUSE_CONFIG__PASSWORD=pandapass
MOOSE_CLICKHOUSE_CONFIG__USE_SSL=false
```

3. **Start the MooseStack dev server** (runs ClickHouse via Docker):

```bash
cd moose
pnpm dev
```

4. **Seed sample data** (in a separate terminal):

```bash
cd moose
pnpm seed
```

5. **Start the Next.js app** (in another terminal):

```bash
pnpm dev
```

6. Open [http://localhost:3000](http://localhost:3000) to view the dashboard.

## Project Structure

```
├── app/                    # Next.js app router
│   ├── page.tsx            # Dashboard page
│   └── actions/            # Server actions calling MooseStack queries
├── components/             # React components (charts, stats, filters)
├── lib/                    # Hooks and utilities
└── moose/                  # MooseStack workspace package
    ├── src/
    │   ├── models.ts       # OlapTable definitions → ClickHouse tables
    │   ├── queries.ts      # Query helpers using sql tagged templates
    │   ├── client.ts       # Shared ClickHouse client initializer
    │   └── index.ts        # Package exports
    ├── seed.sql            # Sample data for demo
    └── moose.config.toml   # MooseStack configuration
```

## How It Works

1. Define `OlapTable` models in `moose/src/models.ts` → MooseStack creates ClickHouse tables
2. Write query helpers in `moose/src/queries.ts` using the `sql` tagged template
3. Export queries from `moose/src/index.ts` → import from `"moose"` in Next.js
4. Call queries from Server Components or Server Actions (keeps credentials server-side)
5. Dashboard components fetch data via React Query

## Learn More

- [MooseStack + Next.js Guide](https://docs.fiveonefour.com/moosestack/getting-started/existing-app/next-js) — Full walkthrough
- [OlapTable Reference](https://docs.fiveonefour.com/moosestack/olap/model-table) — Primary keys, engines, configuration
- [Read Data](https://docs.fiveonefour.com/moosestack/olap/read-data) — Query patterns and the Moose client
- [Migrations](https://docs.fiveonefour.com/moosestack/migrate) — Deploy schema to production ClickHouse
