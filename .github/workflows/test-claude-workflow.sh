#!/bin/bash

# Test script for Claude Documentation Check workflow
# This script helps validate the workflow before pushing to GitHub

set -e

echo "🧪 Claude Documentation Check Workflow Test Script"
echo "================================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if required tools are installed
check_tool() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${RED}❌ $1 is not installed${NC}"
        return 1
    else
        echo -e "${GREEN}✅ $1 is installed${NC}"
        return 0
    fi
}

echo "1. Checking prerequisites..."
echo "----------------------------"
check_tool "yq" || echo "   Install with: brew install yq (macOS) or snap install yq (Linux)"
check_tool "yamllint" || echo "   Install with: pip install yamllint"
check_tool "git"
echo ""

# Validate YAML syntax
echo "2. Validating YAML syntax..."
echo "----------------------------"
WORKFLOW_FILE=".github/workflows/claude-doc-check.yml"

if [ -f "$WORKFLOW_FILE" ]; then
    if yamllint -d relaxed "$WORKFLOW_FILE" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ YAML syntax is valid${NC}"
    else
        echo -e "${RED}❌ YAML syntax errors found:${NC}"
        yamllint -d relaxed "$WORKFLOW_FILE"
        exit 1
    fi
else
    echo -e "${RED}❌ Workflow file not found: $WORKFLOW_FILE${NC}"
    exit 1
fi
echo ""

# Check workflow structure
echo "3. Checking workflow structure..."
echo "---------------------------------"
if yq eval '.name' "$WORKFLOW_FILE" > /dev/null 2>&1; then
    WORKFLOW_NAME=$(yq eval '.name' "$WORKFLOW_FILE")
    echo -e "${GREEN}✅ Workflow name: $WORKFLOW_NAME${NC}"
else
    echo -e "${RED}❌ Missing workflow name${NC}"
fi

# Check triggers
echo ""
echo "4. Checking triggers..."
echo "----------------------"
if yq eval '.on.pull_request' "$WORKFLOW_FILE" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Pull request trigger configured${NC}"
    echo "   Paths monitored:"
    yq eval '.on.pull_request.paths[]' "$WORKFLOW_FILE" | sed 's/^/     - /'
fi

if yq eval '.on.workflow_dispatch' "$WORKFLOW_FILE" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Manual trigger (workflow_dispatch) configured${NC}"
    echo "   Test mode input available: $(yq eval '.on.workflow_dispatch.inputs.test_mode.default' "$WORKFLOW_FILE")"
fi
echo ""

# Check jobs
echo "5. Checking jobs..."
echo "------------------"
JOBS=$(yq eval '.jobs | keys | .[]' "$WORKFLOW_FILE")
echo "Found jobs:"
for job in $JOBS; do
    echo -e "  ${GREEN}✅${NC} $job"
done
echo ""

# Check for required secrets usage
echo "6. Checking secrets usage..."
echo "----------------------------"
if grep -q "ANTHROPIC_API_KEY" "$WORKFLOW_FILE"; then
    echo -e "${GREEN}✅ ANTHROPIC_API_KEY secret is referenced${NC}"
    echo -e "${YELLOW}⚠️  Make sure to add this secret in GitHub repository settings${NC}"
else
    echo -e "${RED}❌ ANTHROPIC_API_KEY secret not found${NC}"
fi
echo ""

# Simulate change detection
echo "7. Simulating change detection..."
echo "---------------------------------"
echo "Testing path patterns:"
TEST_PATHS=(
    "packages/ts-moose-lib/index.ts"
    "packages/py-moose-lib/setup.py"
    "apps/framework-cli/src/main.rs"
    "apps/framework-docs/pages/index.mdx"
    "README.md"
)

for path in "${TEST_PATHS[@]}"; do
    SHOULD_TRIGGER=false
    if [[ "$path" =~ ^packages/ts-moose-lib/ ]] || \
       [[ "$path" =~ ^packages/py-moose-lib/ ]] || \
       [[ "$path" =~ ^apps/framework-cli/ ]]; then
        SHOULD_TRIGGER=true
    fi
    
    if [ "$SHOULD_TRIGGER" = true ]; then
        echo -e "  ${GREEN}✅${NC} $path - Would trigger workflow"
    else
        echo -e "  ${YELLOW}○${NC} $path - Would NOT trigger workflow"
    fi
done
echo ""

# Create test branch simulation
echo "8. Test scenarios..."
echo "-------------------"
echo -e "${YELLOW}Scenario 1: Test Mode (Manual Trigger)${NC}"
echo "  1. Push this workflow to a branch"
echo "  2. Go to Actions tab in GitHub"
echo "  3. Select 'Claude Documentation Check'"
echo "  4. Click 'Run workflow'"
echo "  5. Enable 'Run in test mode' checkbox"
echo "  6. Optionally enter a PR number"
echo "  7. Run the workflow"
echo ""

echo -e "${YELLOW}Scenario 2: Create a Test PR${NC}"
echo "  1. Create a new branch: git checkout -b test-claude-doc-check"
echo "  2. Make a small change in packages/ts-moose-lib/ or packages/py-moose-lib/"
echo "  3. Commit and push the branch"
echo "  4. Open a PR - the workflow should trigger automatically"
echo ""

echo -e "${YELLOW}Scenario 3: Test with Fork (Safest)${NC}"
echo "  1. Fork the repository"
echo "  2. Add the workflow to your fork"
echo "  3. Create a test PR in your fork"
echo "  4. Test without affecting the main repository"
echo ""

# Generate test commands
echo "9. Quick test commands..."
echo "------------------------"
echo "# Create a test branch with a dummy change:"
echo -e "${GREEN}git checkout -b test-claude-docs${NC}"
echo -e "${GREEN}echo '// Test change' >> packages/ts-moose-lib/package.json${NC}"
echo -e "${GREEN}git add packages/ts-moose-lib/package.json${NC}"
echo -e "${GREEN}git commit -m 'test: Testing Claude doc check workflow'${NC}"
echo -e "${GREEN}git push origin test-claude-docs${NC}"
echo ""

# Final summary
echo "========================================="
echo -e "${GREEN}✅ Workflow validation complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Review any warnings above"
echo "2. Add ANTHROPIC_API_KEY to repository secrets"
echo "3. Test using one of the scenarios above"
echo "4. Monitor the Actions tab for workflow runs"
echo ""
echo "Remember: Test mode allows you to validate the workflow"
echo "without consuming Claude API credits!"
echo "========================================="