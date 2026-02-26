# AGENTS.md

MooseStack Python E2E test template.

## Development

- **Start dev server**: `moose-cli dev`
- **Build**: `moose-cli build`

## Hot Reload

Moose has built-in hot reload. When you modify files referenced in `src/__init__.py`, changes are automatically detected and applied. **Do not restart the dev server** after code changes - just save the file and Moose handles the rest.

## Project Structure

- `src/__init__.py` - Entry point that imports all Moose primitives
- `src/ingest/` - Data models and ingestion transforms
- `src/apis/` - API endpoints
- `src/views/` - Materialized views
- `src/workflows/` - Background workflows

## Adding Components

Add files and import them in `src/__init__.py`:

```python
# src/__init__.py
from src.ingest.models import *
from src.apis.my_api import *
```

## Docs

- `moose docs` — browse all available documentation
- `moose docs search "query"` — find specific topics
- `moose docs --raw <slug>` — output raw markdown (for AI consumption)
- [MooseStack Documentation](https://docs.fiveonefour.com/moose)
- [LLM-friendly docs](https://docs.fiveonefour.com/llms.txt)
