---
title: "Quickstart Guide"
description: "Get started with MooseStack in minutes"
order: 1
category: "getting-started"
---

# Quickstart Guide

Welcome to MooseStack! This guide will help you get started with building data-intensive applications using Python.

## Installation

First, install the Moose CLI:

```bash
pip install moose-cli
```

## Create a New Project

Create a new MooseStack project:

```python
# Initialize a new project
moose init my-app

# Navigate to your project
cd my-app

# Start the development server
moose dev
```

## Your First Data Model

Define your first data model in `datamodels/user.py`:

```python
from dataclasses import dataclass
from datetime import datetime

@dataclass
class User:
    id: str
    email: str
    name: str
    created_at: datetime
```

## Next Steps

- Learn about [Data Modeling](/python/data-modeling)
- Explore [OLAP capabilities](/python/olap)
- Set up [Streaming Functions](/python/streaming)

This is a sample page to test the documentation site structure.

