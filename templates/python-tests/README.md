# Template: Python

This is a Python-based Moose template that provides a foundation for building data-intensive applications using Python.

[![PyPI Version](https://img.shields.io/pypi/v/moose-cli?logo=python)](https://pypi.org/project/moose-cli/)
[![Moose Community](https://img.shields.io/badge/slack-moose_community-purple.svg?logo=slack)](https://join.slack.com/t/moose-community/shared_invite/zt-2fjh5n3wz-cnOmM9Xe9DYAgQrNu8xKxg)
[![Docs](https://img.shields.io/badge/quick_start-docs-blue.svg)](https://docs.fiveonefour.com/moose/getting-started/quickstart)
[![MIT license](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

## Getting Started

### Prerequisites

* [Docker Desktop](https://www.docker.com/products/docker-desktop/)
* [Python](https://www.python.org/downloads/) (version 3.8+)
* [An Anthropic API Key](https://docs.anthropic.com/en/api/getting-started)
* [Cursor](https://www.cursor.com/) or [Claude Desktop](https://claude.ai/download)

### Installation

1. Install Moose CLI: `pip install moose-cli`
2. Create project: `moose init <project-name> python`
3. Install dependencies: `cd <project-name> && pip install -r requirements.txt`
4. Run Moose: `moose dev`

You are ready to go! You can start editing the app by modifying primitives in the `app` subdirectory.

## OlapTable Versioning Demo

This template demonstrates OlapTable versioning functionality by including two versions of the same table:

- `UserEvents` v1.0 - Basic structure with MergeTree engine
- `UserEvents` v2.0 - Enhanced with session tracking and ReplacingMergeTree engine

The versioned tables are defined in `app/ingest/models.py` and showcase how multiple versions of the same table can coexist, supporting blue/green migration scenarios.

## Learn More

To learn more about Moose, take a look at the following resources:

- [Moose Documentation](https://docs.fiveonefour.com/moose) - learn about Moose.
- [Sloan Documentation](https://docs.fiveonefour.com/sloan) - learn about Sloan, the MCP interface for data engineering.

## Community

You can join the Moose community [on Slack](https://join.slack.com/t/moose-community/shared_invite/zt-2fjh5n3wz-cnOmM9Xe9DYAgQrNu8xKxg). Check out the [MooseStack repo on GitHub](https://github.com/514-labs/moosestack).

# Engine Testing

This template includes comprehensive tests for all supported ClickHouse engines in `app/ingest/engine_tests.py`:

- **MergeTree**: Default engine for general-purpose tables
- **ReplacingMergeTree**: Deduplication engine with support for version columns and soft deletes
- **SummingMergeTree**: Automatic summation of numeric columns  
- **AggregatingMergeTree**: Advanced aggregation capabilities

The engine test file demonstrates proper configuration for each engine type using the new engine configuration classes to ensure compatibility and correct table creation.

## Deploy on Boreal

The easiest way to deploy your MooseStack Applications is to use [Boreal](https://www.fiveonefour.com/boreal) from 514 Labs, the creators of Moose.

[Sign up](https://www.boreal.cloud/sign-up).

## License

This template is MIT licensed.

