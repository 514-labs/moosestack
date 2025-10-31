# TypeScript MCP Template

This template demonstrates how to integrate the **Model Context Protocol (MCP)** with MooseStack using Express and the `WebApp` class. It showcases MooseStack's "bring your own API framework" capability.

## What is Model Context Protocol (MCP)?

[Model Context Protocol (MCP)](https://modelcontextprotocol.io) is an open protocol that enables AI assistants to securely connect to data sources and tools. It provides a standardized way for LLMs to:

- Access real-time data
- Execute operations
- Interact with external services
- Query databases and APIs

## What This Template Demonstrates

This template shows how to:

1. **Create custom API endpoints** using Express within MooseStack
2. **Implement an MCP server** using `express-mcp-handler`
3. **Mount custom web apps** at specific paths using the `WebApp` class
4. **Define data models** with ClickHouse table creation
5. **Expose tools** that AI assistants can use via MCP

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ MooseStack Dev Server (Port 4000)                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Built-in Routes:                                          │
│  • /mcp          - MooseStack's built-in MCP server       │
│  • /ingest/*     - Data ingestion endpoints               │
│  • /admin/*      - Admin endpoints                        │
│                                                             │
│  Custom WebApp (this template):                           │
│  • /tools        - Your custom MCP server                 │
│    ├─ GET /      - Establish SSE connection               │
│    └─ POST /     - Send MCP messages                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
         │                                    │
         ▼                                    ▼
   ┌──────────┐                         ┌──────────┐
   │ClickHouse│                         │ Redpanda │
   │  (OLAP)  │                         │ (Kafka)  │
   └──────────┘                         └──────────┘
```

## Project Structure

```
.
├── app/
│   ├── index.ts              # Main entry point (exports all modules)
│   ├── ingest/
│   │   └── models.ts         # Data models with IngestPipeline
│   └── apis/
│       └── mcp.ts            # MCP server implementation
├── package.json              # Dependencies including express-mcp-handler
├── tsconfig.json             # TypeScript configuration
├── moose.config.toml         # MooseStack infrastructure config
└── README.md                 # This file
```

## Key Components

### 1. Data Model (`app/ingest/models.ts`)

Defines a minimal `DataEvent` model with ClickHouse table creation:

```typescript
export interface DataEvent {
  eventId: Key<string>;  // Primary key for ClickHouse
  timestamp: Date;
  eventType: string;
  data: string;
}

export const DataEventPipeline = new IngestPipeline<DataEvent>("DataEvent", {
  table: true,    // Create ClickHouse table
  stream: true,   // Enable Kafka streaming
  ingestApi: true // Enable POST /ingest/DataEvent
});
```

### 2. MCP Server (`app/apis/mcp.ts`)

Implements an MCP server using `express-mcp-handler`:

- Uses **Server-Sent Events (SSE)** for bidirectional communication
- Registers a `query_clickhouse` tool for AI assistants
- Mounts at `/tools` to avoid conflict with built-in `/mcp` endpoint

```typescript
const handlers = sseHandlers(serverFactory, {
  onError: (error, sessionId) => console.error(`[MCP Error]`, error),
  onClose: (sessionId) => console.log(`[MCP] Session closed: ${sessionId}`)
});

app.get("/", handlers.getHandler);   // SSE connection
app.post("/", handlers.postHandler); // Message handling

export const mcpServer = new WebApp("mcpServer", app, {
  mountPath: "/tools"
});
```

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Development Server

```bash
moose dev
```

The MCP server will be available at `http://localhost:4000/tools`

### 3. Test the MCP Server

Establish an SSE connection:

```bash
curl -N -H "Accept: text/event-stream" http://localhost:4000/tools
```

This will return a session ID that you can use to send MCP messages.

## MCP Tools Available

### `query_clickhouse`

Executes SQL queries against the ClickHouse database.

**Input Schema:**
```json
{
  "query": "SELECT * FROM DataEvent LIMIT 10"
}
```

**Output Schema:**
```json
{
  "rows": [{ "eventId": "...", "timestamp": "...", ... }],
  "rowCount": 10
}
```

## Testing Data Ingestion

Send a test event to the DataEvent table:

```bash
curl -X POST http://localhost:4000/ingest/DataEvent \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "evt_001",
    "timestamp": "2024-01-01T00:00:00Z",
    "eventType": "test",
    "data": "Hello MCP!"
  }'
```

## Using with AI Assistants

This MCP server can be integrated with AI assistants that support the Model Context Protocol:

1. **Claude Desktop**: Add to your MCP configuration
2. **Custom Clients**: Connect via SSE protocol
3. **Development Tools**: Use for testing and debugging

Example configuration for Claude Desktop:

```json
{
  "mcpServers": {
    "moosestack": {
      "url": "http://localhost:4000/tools"
    }
  }
}
```

## Extending This Template

### Adding More Tools

Register additional tools in `app/apis/mcp.ts`:

```typescript
server.registerTool(
  "your_tool_name",
  {
    title: "Your Tool Title",
    description: "What your tool does",
    inputSchema: {
      param: z.string().describe("Parameter description")
    },
    outputSchema: {
      result: z.any().describe("Result description")
    }
  },
  async ({ param }) => {
    // Your tool implementation
    return {
      content: [{ type: "text", text: "Result" }],
      structuredContent: { result: "data" }
    };
  }
);
```

### Accessing MooseStack Utilities

Use `getMooseUtils()` to access ClickHouse client and other utilities:

```typescript
import { getMooseUtils } from "@514labs/moose-lib";

async ({ query }) => {
  const { clickhouseClient } = getMooseUtils();
  const result = await clickhouseClient.query({ query });
  // Process and return results
}
```

### Adding More Data Models

Create additional data models in `app/ingest/models.ts`:

```typescript
export interface AnotherModel {
  id: Key<string>;
  timestamp: DateTime;
  // ... other fields
}

export const AnotherModelPipeline = new IngestPipeline<AnotherModel>(
  "AnotherModel",
  { table: true, stream: true, ingestApi: true }
);
```

## Learn More

- [MooseStack Documentation](https://docs.moosejs.com)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [express-mcp-handler](https://www.npmjs.com/package/express-mcp-handler)
- [WebApp Class Reference](https://docs.moosejs.com/building-moose-apps/custom-apis)

## Troubleshooting

### Port Already in Use

If port 4000 is already in use, update `moose.config.toml`:

```toml
[server]
port = 4001
```

### TypeScript Errors

Make sure all dependencies are installed:

```bash
npm install
```

### ClickHouse Connection Issues

Verify Docker containers are running:

```bash
docker ps
```

You should see containers for ClickHouse, Redpanda, and Temporal.

## Support

For questions or issues:

- [GitHub Issues](https://github.com/514-labs/moose)
- [Discord Community](https://discord.gg/moose)
- [Documentation](https://docs.moosejs.com)
