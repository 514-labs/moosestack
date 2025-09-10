# Claude Documentation Check Workflow

## Overview

This GitHub Action workflow uses Claude Code to automatically review pull requests that modify the Moose framework components (`ts-moose-lib`, `py-moose-lib`, or `framework-cli`) and check if they require documentation updates.

## Features

- **Automatic Triggering**: Runs on PRs that modify framework components
- **Intelligent Analysis**: Uses Claude AI to analyze code changes and determine documentation requirements
- **PR Comments**: Automatically comments on PRs with documentation feedback
- **Label Management**: Adds `documentation-needed` label when documentation updates are required
- **Path Detection**: Only runs when relevant files are changed to save on API costs

## Setup Instructions

### 1. Install Claude GitHub App

1. Go to the [Claude GitHub App page](https://github.com/apps/claude)
2. Click "Install" and select your repository
3. Grant the necessary permissions

### 2. Add Anthropic API Key

1. Go to your repository settings on GitHub
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add a secret named `ANTHROPIC_API_KEY` with your Anthropic API key
   - Get your API key from [Anthropic Console](https://console.anthropic.com/)

### 3. Enable Workflow

The workflow is automatically enabled once the file is in `.github/workflows/`. No additional configuration needed.

## How It Works

### Trigger Conditions

The workflow triggers when:
- A pull request is **opened**, **synchronized** (new commits pushed), or **reopened**
- The PR contains changes to:
  - `packages/ts-moose-lib/**` - TypeScript Moose Library
  - `packages/py-moose-lib/**` - Python Moose Library  
  - `apps/framework-cli/**` - Framework CLI

### Workflow Steps

1. **Change Detection**: 
   - Checks which components were modified
   - Determines if documentation check is needed
   - Extracts changed files list

2. **Documentation Analysis**:
   - Gets the PR diff
   - Checks if documentation files were updated
   - Runs Claude Code to analyze changes
   - Claude reviews:
     - New features that need documentation
     - Breaking changes requiring migration guides
     - Changed behaviors needing updated examples
     - New configuration options
     - Deprecated features

3. **Feedback**:
   - Posts Claude's analysis as a PR comment
   - Adds `documentation-needed` label if required
   - Provides specific, actionable feedback

## What Claude Checks For

Claude analyzes PRs for:

- **New Features/APIs**: Ensures new functionality is documented
- **Breaking Changes**: Checks for migration guide updates
- **Behavior Changes**: Verifies example code is updated
- **Configuration Changes**: Ensures new options are documented
- **Deprecations**: Checks for proper deprecation notices
- **Code Examples**: Validates that examples match the new implementation

## Documentation Structure

Claude expects documentation in `apps/framework-docs/` with:
- API documentation
- Getting started guides
- Reference documentation
- Migration guides
- Deployment guides
- Workflow documentation

## Customization

### Modify the Prompt

Edit the `system_prompt` and `prompt` fields in the workflow to customize Claude's analysis criteria.

### Change Trigger Paths

Modify the `paths` section under `on.pull_request` to monitor different directories.

### Adjust Claude Model

Change the `model` parameter to use different Claude models (e.g., `claude-3-opus-20240229`).

## Troubleshooting

### Workflow Not Triggering

- Ensure the PR modifies files in the monitored paths
- Check that the workflow file is in `.github/workflows/`
- Verify the workflow syntax is valid

### Claude Not Commenting

- Verify `ANTHROPIC_API_KEY` secret is set correctly
- Check workflow permissions include `pull-requests: write`
- Review Action logs for error messages

### API Rate Limits

- The workflow only runs when relevant files change to minimize API usage
- Consider implementing additional filtering if needed

## Cost Considerations

- Each PR analysis uses Claude API tokens
- The workflow includes path filtering to reduce unnecessary runs
- Monitor your Anthropic API usage dashboard

## Security

- API keys are stored as GitHub secrets
- Workflow has minimal required permissions
- Claude only has read access to PR changes

## Support

For issues with:
- **Workflow**: Open an issue in this repository
- **Claude API**: Contact [Anthropic support](https://support.anthropic.com/)
- **GitHub Actions**: See [GitHub Actions documentation](https://docs.github.com/en/actions)