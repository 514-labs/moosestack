# AGENTS.md

MooseStack Live Heart Rate Leaderboard template - real-time fitness tracking.

## Development

- **Start Moose dev server**: `moose-cli dev`
- **Start Streamlit frontend**: `streamlit run streamlit_app.py`
- **Build**: `moose-cli build`

## Hot Reload

Moose has built-in hot reload. When you modify files referenced in `app/__init__.py`, changes are automatically detected and applied. **Do not restart the dev server** after code changes - just save the file and Moose handles the rest.

## Project Structure

- `app/__init__.py` - Entry point that imports all Moose primitives
- `app/datamodels/` - Data models
- `app/pipelines/` - Data pipelines
- `app/apis/` - API endpoints
- `app/views/` - Materialized views
- `streamlit_app.py` - Streamlit frontend

## Docs

- [MooseStack Documentation](https://docs.fiveonefour.com/moose)
