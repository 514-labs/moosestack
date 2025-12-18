# Fastify & TypeScript Starter

A simple starter template for building APIs with Fastify and TypeScript using Node.js 24+.

## Requirements

- **Node.js 24.0.0 or higher**
- npm

## Installation

```bash
git clone https://github.com/Matschik/fastify-typescript-starter.git
cd fastify-typescript-starter
npm install
```

## Usage

### Development

Start the development server with hot reload:

```bash
npm run dev
```

The server will automatically restart when you change files.

### Production

Start the production server:

```bash
npm run start
```

### Other Commands

```bash
npm run typecheck  # Check for TypeScript errors
npm run format     # Format code with Prettier
```

## Project Structure

```
src/
  ├── index.ts              # Entry point
  ├── app.ts                # Fastify app setup
  ├── router.ts             # Route registration
  └── controller/           # Route handlers
      ├── indexController.ts
      └── userController.ts
```

## Getting Started

1. Start the dev server: `npm run dev`
2. Visit `http://localhost:3006` in your browser
3. Check `http://localhost:3006/api/v1/user` for the API endpoint
4. Edit files in `src/` to see changes automatically

## Features

- ✅ Fastify web framework
- ✅ TypeScript support (no build step needed)
- ✅ Hot reload in development
- ✅ Type checking with `npm run typecheck`

## License

MIT
