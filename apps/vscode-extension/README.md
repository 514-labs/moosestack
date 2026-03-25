# MooseStack / 514 VS Code Extension

This workspace contains the MooseStack / 514 VS Code-family extension used for:

- automatic CLI bootstrap for `moose` and `514`
- automatic installation of recommended editor extensions, including `514-labs.moosestack-lsp`
- nested Moose project discovery inside monorepos
- workspace configuration for `.vscode/settings.json`, `.vscode/extensions.json`, and `.vscode/mcp.json`
- `Moose: Create New Project` scaffolding via `moose init`

The extension is intentionally dependency-light. Shared editor defaults are copied from `templates/_shared` at build time so the extension and templates stay aligned. When installed from the marketplace, the manifest also advertises `514-labs.moosestack-lsp` as part of the extension pack so users get the language support alongside the onboarding workflow.
