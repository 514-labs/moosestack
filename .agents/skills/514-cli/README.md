# 514-cli

A **workflow skill** that teaches agents the basic 514 CLI flow — logging in, linking a project, checking deployments, and browsing docs.

## What it covers

| Section | Commands |
|---------|----------|
| **Authentication** | `514 auth login`, `514 auth whoami`, `514 auth logout`, `514 org switch` |
| **Projects** | `514 project list`, `514 project link`, `514 project setup` |
| **Deployments** | `514 deployment list` |
| **Docs** | `514 doc search`, `514 doc show`, `514 doc list` |
| **Updates** | `514 cli update` |

## Editing

This is a workflow skill — all logic lives in `SKILL.md`. To make changes, edit that file directly. There is no build step.

## Extending

When new CLI commands are added to the 514 platform:

1. Determine which section the command belongs to (or add a new section)
2. Add the command with its flags and usage pattern
3. Update the quick reference table at the bottom of SKILL.md
4. Update the section table in this README
