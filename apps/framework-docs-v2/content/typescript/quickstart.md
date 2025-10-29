---
title: "Quickstart Guide"
description: "Get started with MooseStack in minutes"
order: 1
category: "getting-started"
---

# Quickstart Guide

Welcome to MooseStack! This guide will help you get started with building data-intensive applications.

## Installation

First, install the Moose CLI:

```bash
npm install -g @514labs/moose-cli
```

## Create a New Project

Create a new MooseStack project:

```typescript
// Initialize a new project
npx create-moose-app my-app

// Navigate to your project
cd my-app

// Start the development server
npm run dev
```

## Your First Data Model

Define your first data model in `datamodels/User.ts`:

```typescript
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}
```

## Next Steps

- Learn about [Data Modeling](/typescript/data-modeling)
- Explore [OLAP capabilities](/typescript/olap)
- Set up [Streaming Functions](/typescript/streaming)

This is a sample page to test the documentation site structure.

