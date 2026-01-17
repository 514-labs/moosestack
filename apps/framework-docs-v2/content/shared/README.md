# Shared Content Components

This directory contains reusable MDX content components that can be included in documentation pages using the `:::include` directive.

## Directory Structure

- **`examples/`** - Example components for demonstration purposes
- **`prerequisites/`** - Common prerequisite sections (e.g., installation instructions)

## Usage

To include a shared component in your MDX file:

```mdx
:::include /shared/path/to/component.mdx
```

Example:
```mdx
:::include /shared/prerequisites/install-moose.mdx
```

## Features

- **Nesting**: Components can include other components (up to 3 levels deep)
- **Static Generation**: All includes are resolved at build time
- **Circular Dependency Detection**: Build will fail if circular dependencies are detected

## Circular Dependency Protection

The build process automatically validates all include directives for circular dependencies. If a cycle is detected, the build will fail with a clear error message showing the cycle path.

### Example Error

```
❌ CIRCULAR DEPENDENCY DETECTED

Found 1 circular dependency:

1. Cycle detected:
   shared/examples/component-a.mdx -> shared/examples/component-b.mdx -> shared/examples/component-a.mdx

Please fix the circular dependencies before building.
```

### Manual Validation

You can manually check for circular dependencies at any time:

```bash
pnpm validate:includes
```

## Best Practices

- Keep components focused and single-purpose
- Avoid deep nesting (more than 2 levels)
- Test your includes locally before committing
- Use descriptive file names
