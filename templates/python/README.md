# MooseStack Python Template

This is a MooseStack project created from the Python template.

## Prerequisites

- Python 3.12+
- Docker Desktop

## Run locally

1. Install the Moose CLI:

```bash
bash -i <(curl -fsSL https://fiveonefour.com/install.sh) moose
```

2. Create a virtualenv and install dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
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

- Data models: `app/ingest/models.py`
- Ingestion transforms: `app/ingest/transforms.py`
- APIs: `app/apis/*`
- Views: `app/views/*`
- Workflows: `app/workflows/*`

## Docs

- Quickstart: https://docs.fiveonefour.com/moosestack/getting-started/quickstart
- Data modeling: https://docs.fiveonefour.com/moosestack/data-modeling
- Ingest API: https://docs.fiveonefour.com/moosestack/apis/ingest-api
- Analytics API: https://docs.fiveonefour.com/moosestack/apis/analytics-api
- Workflows: https://docs.fiveonefour.com/moosestack/workflows
