# Python FastAPI Template

A Python FastAPI-based Moose template for building analytical backend services with ClickHouse

[![PyPI Version](https://img.shields.io/pypi/v/moose-cli?logo=python)](https://pypi.org/project/moose-cli/)
[![Moose Community](https://img.shields.io/badge/slack-moose_community-purple.svg?logo=slack)](https://join.slack.com/t/moose-community/shared_invite/zt-2fjh5n3wz-cnOmM9Xe9DYAgQrNu8xKxg)
[![Docs](https://img.shields.io/badge/quick_start-docs-blue.svg)](https://docs.fiveonefour.com/moose/getting-started/quickstart)
[![MIT license](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

## Quick Start

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for ClickHouse, Redis)
- [Python 3.12+](https://www.python.org/downloads/)

### Running the Application

This template requires **two separate servers** to run:

#### 1. Start the Moose Development Environment
```bash
moose dev
```
**Purpose:** This starts the data infrastructure services:
- **ClickHouse database** (port 18123) - for analytical queries
- **Redis cache** (port 6379) - for performance optimization
- **Moose management services** (port 5001) - for data model management

Keep this terminal running - the services need to stay active.

#### 2. Start the FastAPI Server
In a **new terminal window**:
```bash
fastapi dev app/main.py
```

Make sure you have run `pip install fastapi["standard"]` to install the FastAPI CLI.

**Purpose:** This starts your actual API server:
- **FastAPI application** (port 8000) - your REST API endpoints
- **Auto-reload enabled** - restarts when you make code changes
- **Interactive API docs** - available at http://localhost:8000/docs

#### 3. Access Your Application
- **API Server:** http://localhost:8000
- **API Documentation:** http://localhost:8000/docs (Swagger UI)
- **Moose Admin Server:** http://localhost:5001

### What's Included

This template provides:
- **FastAPI server** with data models and API endpoints
- **ClickHouse integration** for analytics queries
- **Redis caching** for performance
- **Pydantic models** for data validation
- **Auto-generated API docs** at `/docs`

### Project Structure

```
app/
├── main.py          # Application entry point
├── api.py           # FastAPI routes and endpoints
├── db/
│   ├── models.py    # Pydantic data models
│   └── views.py     # Database views and aggregations
```

### Development

- Edit `app/api.py` to add new API endpoints
- Modify `app/db/models.py` to update data models
- The FastAPI server auto-reloads when you make changes
- Check both terminals for logs and any errors

## Learn More

- [Moose Documentation](https://docs.fiveonefour.com/moose) - learn about Moose

## Community

Join the Moose community [on Slack](https://join.slack.com/t/moose-community/shared_invite/zt-2fjh5n3wz-cnOmM9Xe9DYAgQrNu8xKxg). Check out the [MooseStack repo on GitHub](https://github.com/514-labs/moosestack).

## Deploy on Boreal

The easiest way to deploy your MooseStack Applications is to use [Boreal](https://www.fiveonefour.com/boreal) from 514 Labs, the creators of Moose.

[Sign up](https://www.boreal.cloud/sign-up).

## License

This template is MIT licensed.

