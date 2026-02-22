# Template: GitHub Trending Topics

This template provides a real-time dashboard tracking trending repositories and topics on GitHub. It collects and analyzes Star Events from the public GitHub events feed using Moose for the backend and a separate dashboard application for the frontend.

**Language:** TypeScript (Backend - Moose), JavaScript/TypeScript (Frontend - Next.js)
**Stack:** Moose, Node.js, Kafka, ClickHouse, Next.js/React (Frontend)
**Package Manager:** pnpm (Monorepo)

**Documentation:** [Template Documentation](https://docs.fiveonefour.com/templates/github)

[![NPM Version](https://img.shields.io/npm/v/%40514labs%2Fmoose-cli?logo=npm)](https://www.npmjs.com/package/@514labs/moose-cli?activeTab=readme)
[![Moose Community](https://img.shields.io/badge/slack-moose_community-purple.svg?logo=slack)](https://join.slack.com/t/moose-community/shared_invite/zt-2fjh5n3wz-cnOmM9Xe9DYAgQrNu8xKxg)
[![Docs](https://img.shields.io/badge/quick_start-docs-blue.svg)](https://docs.fiveonefour.com/moose/getting-started/quickstart)
[![MIT license](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

## Getting Started

### Prerequisites

*   **Node.js** (version 20+)
*   **pnpm** (version 8+)
*   **Docker Desktop** (must be running - Moose starts ClickHouse, Redpanda, Temporal, and Redis containers)
*   **Moose CLI**
*   **C/C++ build tools** - required for the native Kafka module
    *   **macOS:** `xcode-select --install`
    *   **Ubuntu/Debian:** `sudo apt install -y build-essential`
    *   **Fedora/RHEL:** `sudo dnf groupinstall "Development Tools"`
*   **GitHub Personal Access Token** ([create one here](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-personal-access-token-classic)) - optional but recommended to avoid API rate limits

## Project Structure

This is a pnpm monorepo with the following structure:

```
.
├── apps/
│   ├── dashboard/        # Next.js dashboard application
│   └── moose-backend/    # Moose backend service (TypeScript)
├── packages/
│   └── moose-objects/    # Shared Moose types and API definitions, imported by both apps
├── package.json          # Root package.json with workspace scripts
├── pnpm-workspace.yaml   # pnpm workspace configuration
├── Readme.md             # This file
└── template.config.toml  # Template specific configuration
```

### Installation

If you haven't already, install the Moose CLI and pnpm:
```bash
# Install Moose CLI
bash -i <(curl -fsSL https://fiveonefour.com/install.sh) moose

# Install pnpm if not already installed
npm install -g pnpm
```

1. Initialize the project:
```bash
moose init moose-github-dev-trends github-dev-trends
cd moose-github-dev-trends
```

2. Install dependencies:
```bash
pnpm install
```

3. Configure your GitHub token (optional but recommended):
```bash
cp apps/moose-backend/.env.example apps/moose-backend/.env
# Edit apps/moose-backend/.env and replace "your-github-token" with your token
```
Without a token the workflow still runs but will hit GitHub API rate limits quickly.

4. Start everything:
```bash
pnpm dev
```
This builds the shared `moose-objects` package first, then starts both the Moose backend and the Next.js dashboard in parallel. The backend starts local infrastructure (ClickHouse, Redpanda, Temporal, Redis) via Docker.

5. Open the dashboard at [http://localhost:3000](http://localhost:3000)

### Running services individually

You can also start each service separately:

```bash
# Terminal 1: Start the Moose backend only
pnpm moose:dev

# Terminal 2: Start the dashboard only
pnpm dashboard:dev
```

Note: if you start services individually, build the shared packages first:
```bash
pnpm --recursive --filter "./packages/*" build
```

## Available Scripts

From the root directory:

- `pnpm dev` - Build packages, then start both dashboard and backend in parallel
- `pnpm build` - Build all packages and apps
- `pnpm dashboard:dev` - Start only the dashboard
- `pnpm dashboard:build` - Build only the dashboard
- `pnpm moose:dev` - Start only the Moose backend
- `pnpm moose:build` - Build only the Moose backend

## How it Works

1. **Workflow** (`apps/moose-backend/app/scripts/`) - A scheduled workflow polls the GitHub public events API every minute, sending raw events to the Moose ingest endpoint.

2. **Streaming Transform** (`apps/moose-backend/app/ingest/transform.ts`) - WatchEvents are enriched with repository metadata (topics, stars, language) from the GitHub API and transformed into `RepoStarEvent` records.

3. **Consumption API** (`packages/moose-objects/src/index.ts`) - The `topicTimeseries` API queries ClickHouse to aggregate trending topics by time interval, returning the top N topics with event counts, unique repos, and unique users.

4. **Dashboard** (`apps/dashboard/`) - A Next.js app that polls the consumption API and renders an animated bar chart of trending topics over time.

## Deployment

Deploying this project involves deploying the Moose backend service and the frontend dashboard separately.

**Prerequisites:**

*   A GitHub account and your project code pushed to a GitHub repository.
*   A [Boreal](https://boreal.cloud/signup) account for the backend.
*   A [Vercel](https://vercel.com/signup) account (or similar platform) for the frontend.

### 1. Deploying the Moose Backend (Boreal)

*   **Push to GitHub:** Ensure your latest backend code (the contents of the `apps/moose-backend` directory) is committed and pushed to your GitHub repository.
*   **Create Boreal Project:**
    *   Log in to your Boreal account and create a new project.
    *   Connect Boreal to your GitHub account and select the repository containing your project.
    *   Configure the project settings, ensuring Boreal points to the `apps/moose-backend` directory if your repository root contains the monorepo structure.
*   **Configure Environment Variables:**
    *   In the Boreal project settings, add the `GITHUB_TOKEN` environment variable with your GitHub Personal Access Token as the value.
*   **Deploy:** Boreal should automatically build and deploy your Moose service based on your repository configuration.
*   **Note API URL:** Once deployed, Boreal will provide a public URL for your Moose backend API. You will need this for the frontend deployment.

### 2. Deploying the Frontend Dashboard (Vercel)

*   **Push to GitHub:** Ensure your latest frontend code (the contents of the `apps/dashboard` directory) is committed and pushed to your GitHub repository.
*   **Create Vercel Project:**
    *   Log in to your Vercel account and create a new project.
    *   Connect Vercel to your GitHub account and select the repository containing your project.
*   **Configure Project Settings:**
    *   Set the **Root Directory** in Vercel to `apps/dashboard`.
    *   Vercel should automatically detect it's a Next.js project.
*   **Configure Environment Variables:**
    *   Add `NEXT_PUBLIC_MOOSE_URL` pointing to your Boreal API URL:
        ```
        NEXT_PUBLIC_MOOSE_URL=https://your-boreal-project-url.boreal.cloud
        ```
*   **Deploy:** Vercel will build and deploy your Next.js frontend.

Once both are deployed, your live GitHub Trends Dashboard should be accessible via the Vercel deployment URL.

# Deploy on Boreal

The easiest way to deploy your MooseStack Applications is to use [Boreal](https://www.fiveonefour.com/boreal) from 514 Labs, the creators of Moose.

Check out our [Moose deployment documentation](https://docs.fiveonefour.com/moose/deploying) for more details.

## Community

You can join the Moose community [on Slack](https://join.slack.com/t/moose-community/shared_invite/zt-2fjh5n3wz-cnOmM9Xe9DYAgQrNu8xKxg). Check out the [MooseStack repo on GitHub](https://github.com/514-labs/moosestack).
