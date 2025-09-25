#!/bin/bash

# Script to create CLAUDE.md symlinks pointing to AGENTS.md files
# Usage: ./scripts/create-claude-symlinks.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🔗 Creating CLAUDE.md symlinks for all AGENTS.md files...${NC}"
echo

# Get the repository root directory
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Counter for created symlinks
created_count=0
skipped_count=0

# Find all AGENTS.md files, respecting .gitignore
while IFS= read -r -d '' agents_file; do
    # Get the directory containing the AGENTS.md file
    dir=$(dirname "$agents_file")
    
    # Define the CLAUDE.md path in the same directory
    claude_file="$dir/CLAUDE.md"
    
    # Check if CLAUDE.md already exists
    if [[ -e "$claude_file" ]]; then
        if [[ -L "$claude_file" ]]; then
            # It's already a symlink, check if it points to the right place
            current_target=$(readlink "$claude_file")
            if [[ "$current_target" == "AGENTS.md" ]]; then
                echo -e "${YELLOW}⏭️  Skipping $claude_file (already points to AGENTS.md)${NC}"
                ((skipped_count++))
                continue
            else
                echo -e "${YELLOW}⚠️  Updating $claude_file (was pointing to $current_target)${NC}"
                rm "$claude_file"
            fi
        else
            echo -e "${RED}❌ Warning: $claude_file exists but is not a symlink. Skipping.${NC}"
            ((skipped_count++))
            continue
        fi
    fi
    
    # Create the symlink (relative path)
    cd "$dir"
    ln -s "AGENTS.md" "CLAUDE.md"
    cd "$REPO_ROOT"
    
    echo -e "${GREEN}✅ Created symlink: $claude_file -> AGENTS.md${NC}"
    ((created_count++))
    
done < <(git ls-files -z | grep -z 'AGENTS\.md$' | grep -zv '^\.git/')

echo
echo -e "${GREEN}🎉 Summary:${NC}"
echo -e "   Created: $created_count symlinks"
echo -e "   Skipped: $skipped_count files"

if [[ $created_count -gt 0 ]]; then
    echo
    echo -e "${YELLOW}📝 Note: The new symlinks will be tracked by Git.${NC}"
    echo -e "${YELLOW}   Run 'git add .' and commit to include them in your repository.${NC}"
fi

echo -e "${GREEN}✨ Done!${NC}"
