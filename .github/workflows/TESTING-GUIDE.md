# Testing Guide for Claude Documentation Check Workflow

## Overview

This guide explains how to test the Claude Documentation Check workflow before deploying it to production.

## Available Workflows

We provide two workflow implementations:

1. **`claude-doc-check.yml`** - Uses the official `anthropics/claude-code-action` (when available)
2. **`claude-doc-check-alternative.yml`** - Uses Anthropic API directly via Python (fallback option)

## Testing Strategy

### 🧪 Phase 1: Local Validation

Run the test script to validate workflow syntax:

```bash
cd /workspace
./.github/workflows/test-claude-workflow.sh
```

This script will:
- Validate YAML syntax
- Check workflow structure
- Verify path patterns
- Provide test scenarios

### 🧪 Phase 2: Test Mode (No API Required)

Both workflows support a **test mode** that simulates Claude's analysis without using the API.

#### Option A: Manual Trigger (Recommended for Initial Testing)

1. **Push the workflow to a test branch:**
   ```bash
   git checkout -b test-claude-workflow
   git add .github/workflows/claude-doc-check.yml
   git commit -m "test: Add Claude documentation check workflow"
   git push origin test-claude-workflow
   ```

2. **Run manually from GitHub UI:**
   - Go to your repository's **Actions** tab
   - Select "Claude Documentation Check" from the left sidebar
   - Click "Run workflow"
   - Select your test branch
   - ✅ Check "Run in test mode"
   - Optionally enter a PR number to test against
   - Click "Run workflow"

3. **Review the results:**
   - Check the workflow run logs
   - If you provided a PR number, check for the test comment on that PR

#### Option B: Create a Test PR

1. **Create a branch with test changes:**
   ```bash
   git checkout -b test-doc-check-pr
   
   # Make a small change in one of the monitored directories
   echo "// Test change for workflow" >> packages/ts-moose-lib/package.json
   
   git add packages/ts-moose-lib/package.json
   git commit -m "test: Trigger documentation check workflow"
   git push origin test-doc-check-pr
   ```

2. **Open a Pull Request:**
   - Create a PR from `test-doc-check-pr` to `main`
   - The workflow should trigger automatically
   - Check the PR for the test mode comment

### 🧪 Phase 3: Fork Testing (Safest Option)

Test in a fork to avoid any impact on the main repository:

1. **Fork the repository** on GitHub

2. **Clone your fork:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/REPO_NAME.git
   cd REPO_NAME
   ```

3. **Add the workflow and test:**
   - Add the workflow file
   - Create test PRs in your fork
   - Test both test mode and real mode (if you have an API key)

### 🧪 Phase 4: API Testing (Optional)

If you want to test with the real Claude API:

1. **Add the API key to your test repository:**
   - Go to Settings → Secrets and variables → Actions
   - Add `ANTHROPIC_API_KEY` with your key

2. **For the alternative workflow:**
   - The Python-based implementation will work immediately

3. **For the main workflow:**
   - Install the [Claude GitHub App](https://github.com/apps/claude) (if available)
   - Or use the alternative workflow if the app isn't available yet

## Test Scenarios

### Scenario 1: TypeScript Library Change
```bash
# Create a test change
echo "export const testFunction = () => {};" >> packages/ts-moose-lib/src/test.ts
git add packages/ts-moose-lib/src/test.ts
git commit -m "feat: Add test function to ts-moose-lib"
```
**Expected:** Workflow triggers and suggests TypeScript documentation updates

### Scenario 2: Python Library Change
```bash
# Create a test change
echo "def test_function(): pass" >> packages/py-moose-lib/moose_lib/test.py
git add packages/py-moose-lib/moose_lib/test.py
git commit -m "feat: Add test function to py-moose-lib"
```
**Expected:** Workflow triggers and suggests Python documentation updates

### Scenario 3: CLI Change
```bash
# Create a test change
echo "// Test CLI change" >> apps/framework-cli/src/main.rs
git add apps/framework-cli/src/main.rs
git commit -m "feat: Update CLI functionality"
```
**Expected:** Workflow triggers and suggests CLI documentation updates

### Scenario 4: Documentation Already Updated
```bash
# Change both code and docs
echo "export const newFeature = () => {};" >> packages/ts-moose-lib/src/feature.ts
echo "## New Feature" >> apps/framework-docs/src/pages/moose/reference/new-feature.mdx
git add packages/ts-moose-lib/src/feature.ts apps/framework-docs/src/pages/moose/reference/new-feature.mdx
git commit -m "feat: Add new feature with documentation"
```
**Expected:** Workflow acknowledges that documentation was updated

## Debugging

### Check Workflow Logs
1. Go to Actions tab
2. Click on the workflow run
3. Click on each job to see detailed logs

### Common Issues

#### Workflow Not Triggering
- Verify files changed are in monitored paths
- Check that workflow file is in `.github/workflows/`
- Ensure branch protection rules allow workflows

#### API Key Issues
- Verify `ANTHROPIC_API_KEY` is set in repository secrets
- Check the key has sufficient credits/permissions
- Try the alternative workflow if the GitHub App isn't available

#### Comment Not Posting
- Check workflow has `pull-requests: write` permission
- Verify PR number is correct (for manual runs)
- Check GitHub token permissions

## Rollback Plan

If issues occur after deployment:

1. **Quick Disable:**
   ```yaml
   # Add to the top of the workflow
   on:
     workflow_dispatch:  # Only manual trigger
   ```

2. **Complete Removal:**
   ```bash
   git rm .github/workflows/claude-doc-check.yml
   git commit -m "revert: Remove Claude documentation check"
   git push
   ```

## Production Checklist

Before deploying to production:

- [ ] Workflow syntax validated locally
- [ ] Test mode run successfully completed
- [ ] PR comment posting verified
- [ ] Label addition tested (if applicable)
- [ ] API key added to repository secrets
- [ ] Team notified about new workflow
- [ ] Documentation updated in team wiki/docs

## Cost Considerations

- Each PR analysis uses approximately 2,000-4,000 Claude tokens
- Path filtering reduces unnecessary runs
- Test mode allows validation without API costs
- Consider rate limiting for very active repositories

## Support

- **Workflow Issues:** Open an issue in the repository
- **Claude API:** Contact [Anthropic support](https://support.anthropic.com/)
- **GitHub Actions:** See [GitHub Actions documentation](https://docs.github.com/en/actions)