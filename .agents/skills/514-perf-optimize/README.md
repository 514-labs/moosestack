# perf-optimize

A **workflow skill** that guides an agent through profiling and optimizing ClickHouse performance in a 514/Moose deployment.

Unlike rule-based skills, this skill is a single `SKILL.md` — no rules directory, no build system, no generated `AGENTS.md`. Edit `SKILL.md` directly.

## What it does

The agent runs through five stages:

| Stage | Goal |
|-------|------|
| **SETUP** | Authenticate with 514 CLI, identify the target project and active deployment |
| **PROFILE** | Fetch schema and query data, analyze against an optimization checklist, produce a plan |
| **OPTIMIZE** | Apply approved changes, push a branch to trigger a preview deployment |
| **VERIFY** | Compare before/after metrics on the preview deployment |
| **SHIP** | Create a PR with performance evidence |

## Prerequisites

- **514 CLI** — authenticated (`514 auth login`)
- **gh CLI** — for creating the pull request
- A 514/Moose project with at least one active deployment

## Usage

```
/perf-optimize [project-slug]
```

If a project slug is provided, the agent skips the project selection prompt. Otherwise it lists available projects and asks the user to choose.

## Editing

This is a workflow skill — all logic lives in `SKILL.md`. To make changes, edit that file directly. There is no build step.
