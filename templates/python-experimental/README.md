# Template: Python Experimental

This is an experimental Python-based Moose template that demonstrates the new **MooseModel** feature, which provides LSP autocomplete for column names when constructing SQL queries.

## What's New: MooseModel Autocomplete

This template showcases the new `MooseModel` base class that enables IDE autocomplete for column names:

```python
from moose_lib import MooseModel

class BarAggregated(MooseModel):
    day_of_month: int
    total_rows: int
    rows_with_text: int

# NEW: Direct column access with autocomplete!
query = f"""
SELECT {BarAggregated.day_of_month:col}, 
       {BarAggregated.total_rows:col}
FROM bar_aggregated
"""
```

See `app/apis/bar.py` for complete examples using both f-string and Query builder patterns.

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

**⚠️ Important:** This experimental template requires the latest development version of `moose_lib` with MooseModel support.

#### Option 1: Install from Local Development (Recommended for testing)

If you're working from the moosestack repository:

```bash
# 1. Create your project
moose init <project-name> --template python-experimental

# 2. Navigate to project
cd <project-name>

# 3. Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 4. Install the local py-moose-lib in development mode
pip install -e ../../packages/py-moose-lib

# 5. Install other dependencies
pip install -r requirements.txt

# 6. Run Moose
moose dev
```

#### Option 2: Wait for Published Release

The MooseModel feature will be available in the next published release of `moose-cli`. Once published, you can install normally:

```bash
pip install moose-cli
moose init <project-name> --template python-experimental
cd <project-name>
pip install -r requirements.txt
moose dev
```

You are ready to go! You can start editing the app by modifying primitives in the `app` subdirectory.

## Learn More

To learn more about Moose, take a look at the following resources:

- [Moose Documentation](https://docs.fiveonefour.com/moose) - learn about Moose.
- [Sloan Documentation](https://docs.fiveonefour.com/sloan) - learn about Sloan, the MCP interface for data engineering.

## Community

You can join the Moose community [on Slack](https://join.slack.com/t/moose-community/shared_invite/zt-2fjh5n3wz-cnOmM9Xe9DYAgQrNu8xKxg). Check out the [MooseStack repo on GitHub](https://github.com/514-labs/moosestack).

## Deploy on Boreal

The easiest way to deploy your MooseStack Applications is to use [Boreal](https://www.fiveonefour.com/boreal) from 514 Labs, the creators of Moose.

[Sign up](https://www.boreal.cloud/sign-up).

## License

This template is MIT licensed.

