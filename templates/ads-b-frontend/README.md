# Template: ADS-B Frontend

This project processes and transforms aircraft tracking data from various sources into a standardized format for analysis and visualization. It currently pulls military aircraft data from adsb.lol.

It has example workflows, data models and streaming functions. If you want to explore egress primitives, try using [Sloan](https://docs.fiveonefour.com/sloan) to generate them.

This project also has a seed frontend written in Node, to be used when generating frontend applications on top of this.

This project is structured as follows:
```
ads-b-frontend/
├── frontend/ # Frontend placeholder in Node
├── moose/ # Backend services
└── README.md # Project documentation
```

[![NPM Version](https://img.shields.io/npm/v/%40514labs%2Fmoose-cli?logo=npm)](https://www.npmjs.com/package/@514labs/moose-cli?activeTab=readme)
[![Moose Community](https://img.shields.io/badge/slack-moose_community-purple.svg?logo=slack)](https://join.slack.com/t/moose-community/shared_invite/zt-2fjh5n3wz-cnOmM9Xe9DYAgQrNu8xKxg)
[![Docs](https://img.shields.io/badge/quick_start-docs-blue.svg)](https://docs.fiveonefour.com/moose/getting-started/quickstart)
[![MIT license](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

## Getting Started

### Prerequisites

* [Docker Desktop](https://www.docker.com/products/docker-desktop/)
* [Node](https://nodejs.org/en)
* [An Anthropic API Key](https://docs.anthropic.com/en/api/getting-started)
* [Cursor](https://www.cursor.com/) or [Claude Desktop](https://claude.ai/download)

### Installation

1. Install Moose / Sloan: `bash -i <(curl -fsSL https://fiveonefour.com/install.sh) moose,sloan`
2. Create project: `sloan init aircraft ads-b-frontend`
3. Install dependencies: `cd aircraft/moose && npm install`
4. Run Moose: `moose dev`
5. In a new terminal, install frontend dependencies: `cd aircraft/frontend && npm install`
6. Run frontend: `npm run dev`

You are ready to go! You can start editing the app by modifying primitives in the `app` subdirectory. The dev server auto-updates as you edit the file.

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