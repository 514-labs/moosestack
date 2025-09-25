# Release Notes & Changelog Workflow

## Overview
This directory contains the release notes and changelog for Moose. Follow this workflow to create consistent, informative release entries.

## Quick Process
1. **Get merged PRs**: Use GitHub API or MCP to list recent merged PRs
2. **Version each PR**: Bump PATCH version for each (v1.3.0 → v1.3.1 → v1.3.2)
3. **Add to changelog**: Insert at top of `index.mdx`

## Entry Template
```markdown
# v1.3.2 - 2025-09-25

## Release highlights
* Brief description of main change ([#1234](link) by [@username](link))

## [Section]
* Description ([#1234](link) by [@username](link))

## Breaking changes
* None in this release / List breaking changes
```

## Section Categories
- **Added**: New features
- **Changed**: Modifications to existing features  
- **Fixed**: Bug fixes
- **Security**: Security improvements
- **Deprecated**: Soon-to-be removed features

## Automation Hints
- Use GitHub MCP server: `mcp_github-mcp_list_pull_requests` 
- Filter by merged PRs since last release
- Extract PR title, number, author automatically
- Reference templates: `/src/components/md-templates/`

## Writing Guidelines
- Keep descriptions concise but clear
- Focus on user impact, not internal changes
- Link to relevant documentation for new features
- Use consistent formatting across entries
- Include migration guides for breaking changes

## File Structure
- `index.mdx` - Main changelog file
- Individual release files for major versions
- Template files in `/src/components/md-templates/`

## Quality Checklist
- [ ] All merged PRs since last release included
- [ ] Version numbers follow semantic versioning
- [ ] Links to PRs and contributors work
- [ ] Breaking changes clearly documented
- [ ] Release highlights capture main improvements
- [ ] Formatting matches existing entries
