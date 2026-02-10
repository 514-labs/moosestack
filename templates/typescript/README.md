# MooseStack TypeScript Template

This is a MooseStack project created from the TypeScript template.

## Run locally

1. Install the Moose CLI:

```bash
bash -i <(curl -fsSL https://fiveonefour.com/install.sh) moose
```

2. Install dependencies:

```bash
pnpm install
```

3. Start MooseStack:

```bash
moose dev
```

## Verify

```bash
curl http://localhost:4000/health
```

Logs are written to `~/.moose/*-cli.log`.

## Where to start

- Data models: `app/ingest/models.ts`
- Ingestion transforms: `app/ingest/transforms.ts`
- APIs: `app/apis/*`
- Views: `app/views/*`
- Workflows: `app/workflows/*`

## Docs

- Quickstart: https://docs.fiveonefour.com/moosestack/getting-started/quickstart
- Data modeling: https://docs.fiveonefour.com/moosestack/data-modeling
- Ingest API: https://docs.fiveonefour.com/moosestack/apis/ingest-api
- Analytics API: https://docs.fiveonefour.com/moosestack/apis/analytics-api
- Workflows: https://docs.fiveonefour.com/moosestack/workflows
