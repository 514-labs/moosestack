# Fastify & TypeScript Starter

A simple starter template for building APIs with Fastify and TypeScript using Node.js 24+.

This example is a small monorepo:
- `./` is the Fastify app (ESM)
- `./moose` is the Moose project (CommonJS output)

## Requirements

- **Node.js 24.0.0 or higher**
- pnpm

## Installation

```bash
pnpm install
```

## Usage

### Development

Start the Fastify development server with hot reload:

```bash
pnpm dev
```

The server will automatically restart when you change files.

Start Moose dev mode (run in another terminal):

```bash
pnpm dev:moose
```

### Production

Start the production server:

```bash
pnpm start
```

### Other Commands

```bash
pnpm typecheck   # Check for TypeScript errors
pnpm format      # Format code with Prettier
pnpm build:moose # Build Moose outputs in ./moose/dist
```

## Project Structure

```
src/
  ├── index.ts              # Entry point
  ├── app.ts                # Fastify app setup
  ├── router.ts             # Route registration
  └── controller/           # Route handlers
      ├── indexController.ts
      └── clickhouseController.ts
moose/
  ├── moose.config.toml
  ├── package.json
  ├── src/
  └── tsconfig.json
```

## Getting Started

1. Start the dev server: `pnpm dev`
2. Visit `http://localhost:3006` in your browser
3. Check `http://localhost:3006/api/v1/clickhouse/recent` for the API endpoint
4. Edit files in `src/` to see changes automatically

## Features

- ✅ Fastify web framework
- ✅ TypeScript support (no build step needed)
- ✅ Hot reload in development
- ✅ Type checking with `pnpm typecheck`

## License

MIT
