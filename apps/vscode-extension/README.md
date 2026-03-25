# Fiveonefour VS Code Extension

This workspace contains the Fiveonefour VS Code-family extension used for:

- automatic bootstrap for trusted Moose workspaces, gated by a one-time “Bootstrap” confirmation before the extension installs CLI tools, installs recommended extensions, or updates `.vscode/*`
- CLI bootstrap for `moose` and `514`, using the official `https://fiveonefour.com/install.sh` script only after that trusted-workspace bootstrap confirmation and a separate modal installer confirmation
- automatic installation of recommended editor extensions, including `514-labs.moosestack-lsp`, during trusted-workspace bootstrap with no separate confirmation prompt today
- nested Moose project discovery inside monorepos
- workspace configuration for `.vscode/settings.json`, `.vscode/extensions.json`, and `.vscode/mcp.json`
- `Fiveonefour: Create Moose Project` scaffolding via `moose init`
- a homepage-branded “Get started with your MooseStack Project” panel that keeps the cleaned post-scaffold instructions from `moose init` and links to MooseStack docs, Hosting docs, and fiveonefour.com
- non-interactive `514 agent init` driven by `514 agent init schema --json`, with versioned JSON requests sent over stdin for the current editor host
- status bar activity, completion states, and output-channel logs for long-running setup actions
- automatic bootstrap backs off after an initial full scan finds no Moose projects, while manual commands still force a rescan

The extension is intentionally dependency-light. Shared editor defaults are copied from `templates/_shared` at build time so the extension and templates stay aligned. When installed from the marketplace, the manifest advertises `514-labs.moosestack-lsp` as part of the extension pack so users get the language support alongside the onboarding workflow without blocking Fiveonefour activation if the LSP is unavailable.

When the extension configures a Moose workspace, it resolves the current editor to `vscode`, `cursor`, or `kiro`, fetches the `514 agent init` schema, and runs the CLI in non-interactive JSON mode. If the installed `514` CLI does not advertise a compatible schema or the current editor agent id is unsupported, the extension pauses automatic dev-harness setup for that workspace until you rerun it manually.

In Restricted Mode, Fiveonefour stays active in a limited form so it can still discover Moose projects and show setup status. Commands that modify the workspace or run the Moose/514 CLIs require the workspace to be trusted.

Keeping a folder in Restricted Mode, or declining the initial trusted-workspace “Bootstrap” prompt, pauses automatic bootstrap. Manual commands such as `Fiveonefour: Configure Workspace` and `Fiveonefour: Re-run Dev Harness Setup` remain available and count as explicit opt-in for future automatic runs.
