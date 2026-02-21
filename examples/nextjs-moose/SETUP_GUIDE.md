# Next.js + MooseStack Monorepo Setup Guide

Import compiled MooseStack objects (OlapTables, IngestPipelines, types) into a Next.js app via pnpm workspaces.

## Final Structure

```
my-project/
├── pnpm-workspace.yaml
├── package.json              # root workspace config
├── web/                      # Next.js app (create-next-app)
│   ├── package.json          # "moose": "workspace:*"
│   ├── next.config.ts        # serverExternalPackages
│   └── app/
│       ├── actions.ts        # server actions importing from "moose"
│       └── page.tsx
└── moose/                    # MooseStack project (moose-cli init)
    ├── package.json          # main/types -> dist/app/
    ├── tsconfig.json
    ├── moose.config.toml
    └── app/
        ├── index.ts          # barrel export
        └── ingest/models.ts  # OlapTables, IngestPipelines
```

## Step 1: Create root workspace

```bash
mkdir my-project && cd my-project
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - web
  - moose
```

Create root `package.json`:

```json
{
  "private": true,
  "scripts": {
    "dev:moose": "pnpm -C moose dev",
    "dev:web": "pnpm -C web dev",
    "build:moose": "pnpm -C moose run build",
    "build:web": "pnpm -C web build"
  },
  "pnpm": {
    "onlyBuiltDependencies": [
      "@514labs/kafka-javascript",
      "@confluentinc/kafka-javascript",
      "@swc/core",
      "protobufjs",
      "sharp"
    ]
  }
}
```

`onlyBuiltDependencies` is required because pnpm 10 blocks native addon builds by default. `@514labs/kafka-javascript` is a native Node addon used by moose-lib.

## Step 2: Create Next.js app

```bash
npx create-next-app@latest web --yes --ts --app
```

Remove the npm lockfile (we use pnpm):

```bash
rm web/package-lock.json
```

## Step 3: Init MooseStack project from template

```bash
npx @514labs/moose-cli@0.6.399 init moose typescript
```

Remove artifacts that conflict with the monorepo:

```bash
rm -rf moose/.git moose/.npmrc
```

## Step 4: Fix template defaults

The template needs three changes to work as a workspace package.

### 4a. Fix export paths in `moose/package.json`

The template sets `"main": "dist/index.js"`, but `moose-tspc` compiles `app/` source to `dist/app/`. Update `main` and `types` to match the actual output path, upgrade the moose-lib/cli versions, and move `@faker-js/faker` to dependencies (the template workflow imports it but lists it as a devDependency):

```json
{
  "name": "moose",
  "private": true,
  "version": "0.0.1",
  "engines": {
    "node": ">=20 <25"
  },
  "main": "dist/app/index.js",
  "types": "dist/app/index.d.ts",
  "scripts": {
    "moose": "moose-cli",
    "build": "moose-tspc",
    "dev": "moose-cli dev"
  },
  "dependencies": {
    "@514labs/moose-lib": "0.6.399",
    "@faker-js/faker": "^10.3.0",
    "ts-patch": "^3.3.0",
    "typia": "^9.6.1"
  },
  "devDependencies": {
    "@514labs/moose-cli": "0.6.399",
    "@types/node": "^20.12.12"
  },
  "pnpm": {
    "onlyBuiltDependencies": [
      "@514labs/kafka-javascript",
      "@confluentinc/kafka-javascript"
    ]
  }
}
```

Changes from template:
- `main`/`types`: `dist/index.js` -> `dist/app/index.js` (matches moose-tspc output)
- `build` script: `moose-cli build --docker` -> `moose-tspc` (workspace compilation vs Docker packaging)
- `@514labs/moose-lib` and `@514labs/moose-cli`: `0.6.309` -> `0.6.399` (template hardcodes an older version)
- `@faker-js/faker`: moved from devDependencies to dependencies

### 4b. Switch to pnpm in `moose/moose.config.toml`

Change the `package_manager` line:

```toml
[typescript_config]
package_manager = "pnpm"
```

## Step 5: Wire Next.js to the moose workspace package

Add `"moose": "workspace:*"` to `web/package.json` dependencies:

```json
{
  "dependencies": {
    "moose": "workspace:*",
    "next": "...",
    "react": "...",
    "react-dom": "..."
  }
}
```

Add `serverExternalPackages` to `web/next.config.ts`:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["moose", "@514labs/moose-lib"],
};

export default nextConfig;
```

This tells Next.js to `require()` these at runtime instead of bundling them. Required because moose-lib depends on `@514labs/kafka-javascript`, a native Node addon that cannot be bundled.

## Step 6: Install and compile

```bash
pnpm install
pnpm build:moose
```

Verify the compiled output:

```bash
ls moose/dist/app/index.js moose/dist/app/index.d.ts
```

## Step 7: Import moose objects in Next.js

The template's `app/index.ts` barrel-exports everything. Import in your Next.js server actions:

```typescript
// web/app/actions.ts
"use server";

import { BarPipeline, FooPipeline } from "moose";
import type { Bar, Foo } from "moose";

export async function getPipelines() {
  return {
    foo: { name: FooPipeline.name, config: FooPipeline.config },
    bar: { name: BarPipeline.name, config: BarPipeline.config },
  };
}
```

```typescript
// web/app/page.tsx
import { getPipelines } from "./actions";

export default async function Home() {
  const pipelines = await getPipelines();

  return (
    <main>
      <h1>Next.js + MooseStack</h1>
      <pre>{JSON.stringify(pipelines, null, 2)}</pre>
    </main>
  );
}
```

Build the Next.js app to verify the import resolves:

```bash
pnpm build:web
```

## Development Workflow

Run in two terminals:

```bash
# Terminal 1: MooseStack dev server (starts ClickHouse, compiles with tspc --watch)
pnpm dev:moose

# Terminal 2: Next.js dev server
pnpm dev:web
```

`moose dev` uses `tspc --watch` for incremental compilation. When you edit a `.ts` file in `moose/app/`, it recompiles to `dist/app/` automatically. The Next.js dev server picks up the changes.

## Production Deployment

Two things deploy separately:

1. **Moose backend** (ClickHouse, Kafka, the moose HTTP server) -- to Boreal or self-hosted Docker
2. **Next.js frontend** -- to Vercel (or any Node.js host)

### Deploy Moose backend

```bash
# Option A: Boreal (managed hosting from the MooseStack team)
cd moose && moose-cli deploy

# Option B: Docker
cd moose && moose-cli build --docker
# Push and deploy the image from .moose/
```

### Deploy Next.js to Vercel

1. Push the monorepo to GitHub
2. Import in Vercel, set root directory to `web/`
3. Set the build command to compile moose first:

```
cd .. && pnpm build:moose && cd web && pnpm build
```

4. Set environment variables for the production ClickHouse connection:

```
MOOSE_CLICKHOUSE_CONFIG__HOST=your-clickhouse-host.com
MOOSE_CLICKHOUSE_CONFIG__PORT=8443
MOOSE_CLICKHOUSE_CONFIG__USER=default
MOOSE_CLICKHOUSE_CONFIG__PASSWORD=your-password
MOOSE_CLICKHOUSE_CONFIG__DB_NAME=your-database
MOOSE_CLICKHOUSE_CONFIG__USE_SSL=true
```

### ClickHouse client for server actions

To query ClickHouse from Next.js server actions, create a client in your moose package that reads connection details from environment variables:

```typescript
// moose/app/client.ts
import { getMooseClients, QueryClient } from "@514labs/moose-lib";

async function getClickhouseClient(): Promise<QueryClient> {
  const { client } = await getMooseClients({
    host: process.env.MOOSE_CLICKHOUSE_CONFIG__HOST ?? "localhost",
    port: process.env.MOOSE_CLICKHOUSE_CONFIG__PORT ?? "18123",
    username: process.env.MOOSE_CLICKHOUSE_CONFIG__USER ?? "panda",
    password: process.env.MOOSE_CLICKHOUSE_CONFIG__PASSWORD ?? "pandapass",
    database: process.env.MOOSE_CLICKHOUSE_CONFIG__DB_NAME ?? "local",
    useSSL:
      (process.env.MOOSE_CLICKHOUSE_CONFIG__USE_SSL ?? "false") === "true",
  });

  return client.query;
}

export const db = () => getClickhouseClient();
```

Export it from `app/index.ts` and use in server actions:

```typescript
// web/app/actions.ts
"use server";
import { db } from "moose";

export async function getEvents() {
  const client = await db();
  const result = await client.execute`SELECT * FROM Bar LIMIT 10`;
  return result.json();
}
```

In development, `moose dev` provides local ClickHouse on port 18123. In production, the env vars point to your deployed ClickHouse instance.

## Known Issues

| Issue | Workaround |
|---|---|
| `moose-tspc` outputs to `dist/app/` but template sets `main: dist/index.js` | Change `main`/`types` to `dist/app/index.js` (Step 4a) |
| Template hardcodes `@514labs/moose-lib@0.6.309` regardless of CLI version | Manually upgrade version in `moose/package.json` |
| Template lists `@faker-js/faker` as devDependency but workflow source imports it | Move to dependencies |
| pnpm 10 blocks native addon builds | Add `onlyBuiltDependencies` in root `package.json` |
| Next.js tries to bundle kafka-javascript native addon | Add `serverExternalPackages` in `next.config.ts` |
| `moose-cli build --docker` does not populate project `dist/` | Use `moose-tspc` for workspace builds, `moose-cli build` for Docker packaging |
