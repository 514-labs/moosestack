# Documentation & Content Guide

## Overview
This directory contains the Moose documentation site built with Next.js. All content should follow the Moose brand voice and content guidelines.

## Development Commands
- **Development**: `pnpm dev`
- **Build**: `pnpm build`
- **Lint**: `pnpm lint`
- **Format**: `pnpm format`

## Moose Brand Voice Guidelines

### Core Principles
- **Technical yet approachable**: Accurate but clear to all skill levels
- **Problem-solution focused**: Lead with pain points, show Moose's solution
- **Direct and conversational**: Write to fellow developers using "you"
- **Confident without hype**: Back claims with specifics, avoid buzzwords

### Writing Style
- **Active voice**: "Moose handles migration" not "migration is handled"
- **Precise details**: "5× faster" not "significantly faster"
- **Specific tech**: Mention ClickHouse, Redpanda by name when relevant
- **Educational tone**: Teach concepts, don't just promote

### Key Phrases
- Use "No more [pain point]" to highlight eliminated friction
- Frame as "You had to do X, now you can do Y"
- List concrete benefits: "You get end-to-end infrastructure..."

### Avoid
- Vague terms: "revolutionary", "cutting-edge", "game-changing"
- Passive voice and unnecessary jargon
- Pure promotion without educational value

## Content Types

### Documentation Pages (`.mdx`)
- Start with clear problem statement
- Show code examples early
- Include practical use cases
- End with next steps or related topics

### Blog Posts
- Lead with developer pain points
- Demonstrate solutions with real examples
- Include performance metrics when available
- Maintain educational focus

### API Documentation
- Use consistent formatting
- Include request/response examples
- Document error cases
- Provide SDK examples in multiple languages

## File Organization
- `/src/pages/` - Main documentation pages
- `/src/components/` - Reusable React components
- `/public/` - Static assets (images, etc.)
- `/llm-docs/` - AI-optimized documentation

## Style Guidelines
- Use consistent heading hierarchy
- Include code syntax highlighting
- Optimize images for web
- Test all links and examples
- Follow accessibility best practices

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
