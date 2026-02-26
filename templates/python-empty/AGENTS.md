# AGENTS.md

Empty MooseStack Python template - minimal starting point.

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
- `app/scripts/` - Utility scripts

## Adding Components

Add files and import them in `app/__init__.py`:

```python
# app/__init__.py
from app.ingest.models import *
from app.apis.my_api import *
```

## Docs

- [MooseStack Documentation](https://docs.fiveonefour.com/moose)
