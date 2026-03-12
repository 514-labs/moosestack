# Template Packaging & Maintenance Guide

How templates are structured, packaged, and shipped to users.

## How Packaging Works

When `scripts/package-templates.js` runs (during CI release or locally via `node scripts/package-templates.js`), it processes each template directory into a `.tgz` archive:

```
For each template directory (excluding dirs starting with _):

1. Read template.config.toml → extract metadata (language, description, etc.)
2. Copy template to a staging directory (excluding node_modules)
3. Inject shared files:
   a. _shared/ files         → all templates (skip if template has its own copy)
   b. _shared-<language>/    → matching language only (skip if template has its own copy)
4. Inject versions from _versions.toml into package.json / requirements.txt
5. Verify injected versions match expectations (fails on mismatch)
6. Regenerate lockfiles (pnpm-lock.yaml / package-lock.json)
7. Create .tgz archive
8. Clean up staging directory
```

After all templates are processed, a `manifest.toml` is written with metadata for each template. If any template fails to package, the script exits non-zero.

The packaged `.tgz` files are uploaded to GCS and downloaded by `moose init` when users create new projects.

## Directory Layout

```
templates/
  _shared/                  # Files injected into ALL templates
  _shared-typescript/       # Files injected into language=typescript templates
  _shared-python/           # Files injected into language=python templates
  _versions.toml            # Centralized version pins for moose-lib and moose-cli
  TEMPLATES.md              # This file
  typescript-empty/         # Individual template directories (all at top level)
  typescript-express/
  python-empty/
  python-fastapi/
  next-app-empty/
  ...
```

## Shared Files

Shared files eliminate duplication across templates. There are three levels:

| Directory | Injected Into | Example Files |
|-----------|--------------|---------------|
| `_shared/` | All templates | `.mcp.json`, `.vscode/settings.json`, `.vscode/extensions.json` |
| `_shared-typescript/` | Templates with `language = "typescript"` | `.npmrc`, `.gitignore`, `tsconfig.json` |
| `_shared-python/` | Templates with `language = "python"` | `.gitignore` |

### Override Rule

If a template has its own copy of a shared file, the shared version is **not** injected. This lets templates opt out of shared defaults by committing their own version.

For example, `typescript-empty/tsconfig.json` has custom `paths` configuration, so it keeps its own copy and the shared `tsconfig.json` is skipped for that template.

### What Users Get

Users receive the **packaged** template (with shared files injected), not the source template. The `.tgz` archive is the final product. E2E tests also use the packaged archives, so they test the same artifact users receive.

## Common Maintenance Tasks

### Update a shared file

Edit the file in the appropriate `_shared*/` directory. All templates that don't override it will pick up the change at next packaging.

```bash
# Example: update the MCP server config for all templates
vim templates/_shared/.mcp.json
```

### Add a new shared file

1. Place the file in `_shared/`, `_shared-typescript/`, or `_shared-python/`
2. Delete per-template copies from any templates that had the identical content
3. Templates that need a different version keep their own copy (override rule)

### Update dependency versions

Edit `_versions.toml`:

```toml
[versions]
moose-lib = "0.6.450"
moose-cli = "0.6.450"
```

The packaging script injects these into every template's `package.json` and `requirements.txt`, then regenerates lockfiles.

### Add a new template

1. Create a directory under `templates/` (not starting with `_`)
2. Add a `template.config.toml` with at minimum:
   ```toml
   language = "typescript"  # or "python"
   ```
3. Add your template files. Shared files from `_shared/` and `_shared-<language>/` are injected automatically during packaging — only commit files that are unique to your template or that override a shared default.
4. Test packaging: `node scripts/package-templates.js`

### Test a template locally

Templates cannot be run directly from the repo. They must be packaged and initialized:

```bash
# 1. Build the CLI
cargo build --package moose-cli

# 2. Package templates (creates .tgz files)
node scripts/package-templates.js

# 3. Initialize in a temp directory
cd /tmp && ~/repos/moosestack/target/debug/moose-cli init my-test-app <template-name>

# 4. Verify
cd /tmp/my-test-app && ls -la
```

## template.config.toml

Every template must have a `template.config.toml`. The `language` field determines which `_shared-<language>/` files are injected. All fields are included in the published `manifest.toml`.

```toml
language = "typescript"  # Must be "typescript" or "python"
# Additional metadata fields are passed through to manifest.toml
```

## Debugging

- **Packaging logs** show each injection, version change, and lockfile regen
- **Version mismatch** — packaging fails with an error if injected versions don't match expectations
- **Lockfile regen failure** — stale lockfiles are deleted (not shipped) so users get a fresh lockfile on install
- **Partial failures** — if any template fails to package, the script exits non-zero after processing all templates
