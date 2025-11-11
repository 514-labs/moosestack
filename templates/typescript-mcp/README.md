# TypeScript MCP Template

This template provides a complete example of building AI-powered applications with MooseStack and the Model Context Protocol (MCP).

## Overview

This template contains two independent applications that work together:

### 1. `moosestack-service/`

A MooseStack service template that demonstrates how to build a data service with an integrated MCP server. This service:

- Provides a complete MooseStack data pipeline example
- Exposes an MCP server that AI agents can connect to
- Includes data ingestion, processing, and API capabilities
- Can be run independently for development and testing

### 2. `web-app-with-ai-chat/`

A Next.js web application with a pre-configured AI chat interface. This application:

- Features a modern, responsive layout with an integrated chat panel
- Includes a fully functional AI chat interface out of the box
- Is configured to connect to the MooseStack service MCP server
- Provides a ready-to-use foundation for building AI-powered user experiences

## Getting Started

Both applications can be started independently:

### Start the MooseStack Service

```bash
cd moosestack-service
npm install
npm run dev
```

### Start the Next.js Web App

```bash
cd web-app-with-ai-chat
npm install
npm run dev
```

## How They Work Together

1. The **moosestack-service** runs your data pipeline and exposes an MCP server that provides AI agents with access to your data and tools
2. The **web-app-with-ai-chat** provides a user interface where users can interact with an AI agent
3. The AI agent in the web app connects to the MCP server to access your data and capabilities
4. Users can chat naturally with the AI, which uses the MCP server to answer questions and perform actions on your data

## Next Steps

- Customize the MooseStack service with your own data models and APIs
- Extend the AI chat interface with additional features and integrations
- Configure the MCP connection settings to match your deployment environment

For more detailed information, see the README files in each subdirectory.
