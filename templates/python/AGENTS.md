# AGENTS.md

MooseStack Python application with OLAP database, streaming, and APIs.

## Development

- **Start dev server**: `moose-cli dev`
- **Build**: `moose-cli build`

## Hot Reload

Moose has built-in hot reload. When you modify files referenced in `app/__init__.py`, changes are automatically detected and applied. **Do not restart the dev server** after code changes - just save the file and Moose handles the rest.

## Project Structure

- `app/__init__.py` - Entry point that imports all Moose primitives
- `app/ingest/` - Data models and ingestion transforms
- `app/apis/` - API endpoints
- `app/views/` - Materialized views
- `app/workflows/` - Background workflows

## Adding Components

Manually add files and import them in `app/__init__.py`:

```python
# app/__init__.py
from app.ingest.models import *
from app.apis.my_api import *
```

## Docs

- `moose docs` — browse all available documentation
- `moose docs search "query"` — find specific topics
- `moose docs --raw <slug> | claude "..."` — pipe docs directly to your AI assistant
- [MooseStack Documentation](https://docs.fiveonefour.com/moose)
- [Python SDK Reference](https://docs.fiveonefour.com/moose/building/overview)
- [LLM-friendly docs](https://docs.fiveonefour.com/llms.txt)
