# 🚀 Quick Testing Guide for Claude Documentation Check

## Three Ways to Test Before Merging

### Option 1: Test Mode (Easiest - No API Key Required) ✅

1. **Push workflow to a test branch:**
```bash
git checkout -b test-claude-docs
git add .github/workflows/claude-doc-check.yml
git commit -m "test: Add Claude documentation check workflow"
git push origin test-claude-docs
```

2. **Run manually from GitHub:**
   - Go to **Actions** tab in your repo
   - Select "Claude Documentation Check"
   - Click "Run workflow"
   - ✅ Enable "Run in test mode"
   - Click green "Run workflow" button

3. **Check results:**
   - View the workflow run
   - It will simulate Claude's analysis without using the API

### Option 2: Create a Test PR 📝

1. **Make a test change:**
```bash
git checkout -b test-pr-claude
echo "// Test" >> packages/ts-moose-lib/package.json
git add packages/ts-moose-lib/package.json
git commit -m "test: Testing Claude workflow"
git push origin test-pr-claude
```

2. **Open a PR** and the workflow will trigger automatically

### Option 3: Fork Testing (Safest) 🔒

Test in a fork to avoid any impact on main repository:

1. **Fork the repository on GitHub**
2. **Add the workflow to your fork**
3. **Create test PRs in your fork**
4. **Test both test mode and real mode (with API key)**

## What Gets Tested?

The test mode will verify:
- ✅ Workflow triggers correctly
- ✅ Change detection works
- ✅ PR commenting functions
- ✅ Path filtering is accurate
- ✅ Label addition works (if configured)

## After Testing

Once confirmed working:
1. Add `ANTHROPIC_API_KEY` to repository secrets
2. Remove test branches
3. The workflow is ready for production use!

## Need Help?

- Check `.github/workflows/TESTING-GUIDE.md` for detailed instructions
- Review workflow logs in the Actions tab
- The workflows have built-in debugging output