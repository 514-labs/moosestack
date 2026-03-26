# Fiveonefour

Fiveonefour sets up MooseStack development inside VS Code-family editors.

## What It Does

- Configures dev and runtime harnesses for supported editor hosts
- Creates MooseStack projects with `moose init`
- Bootstraps the `moose` and `514` CLIs
- Discovers nested MooseStack projects inside monorepos
- Syncs workspace defaults into `.vscode/settings.json`, `.vscode/extensions.json`, and `.vscode/mcp.json`
- Installs recommended extensions, including `514-labs.moosestack-lsp`
- Shows setup progress, completion state, and output-channel logs for long-running actions

## Bootstrap and Trust Model

- Automatic bootstrap runs only in a trusted workspace
- A one-time `Bootstrap` confirmation gates workspace updates, CLI installation, and recommended extension installation
- CLI installation uses the official Fiveonefour installer and a separate installer confirmation
- If the initial scan finds no MooseStack projects, automatic bootstrap backs off until a later rescan
- Manual commands such as `Fiveonefour: Configure Workspace` and `Fiveonefour: Re-run Dev Harness Setup` remain available and count as explicit opt-in for future automatic runs

## Dev Harness Setup

- Fiveonefour detects the current editor host as `vscode`, `cursor`, or `kiro`
- It runs `514 agent init` in non-interactive JSON mode using `514 agent init schema --json`
- If the installed `514` CLI does not advertise a compatible schema or the current editor is unsupported, automatic dev harness setup pauses until you rerun it manually

## Commands

- `Fiveonefour: Create Moose Project`
- `Fiveonefour: Configure Workspace`
- `Fiveonefour: Re-run Dev Harness Setup`
- `Fiveonefour: Show Setup Status`
- `Fiveonefour: Select Active Moose Project`

## Restricted Mode

In Restricted Mode, Fiveonefour stays active in a limited form so it can still discover MooseStack projects and show setup status. Commands that modify the workspace or run the Moose/514 CLIs require workspace trust.

## Resources

- [MooseStack Docs](https://docs.fiveonefour.com/moosestack)
- [Support Slack](http://slack.moosestack.com/)
- [Repository](https://github.com/514-labs/moosestack/tree/main/apps/vscode-extension)
