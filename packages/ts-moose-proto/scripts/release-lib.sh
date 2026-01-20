#/usr/bin/env bash

set -eo pipefail

# Retry function for pnpm install (handles npm registry propagation delay)
retry_pnpm_install() {
    local max_attempts=5
    local delay=15
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        echo "Attempt $attempt of $max_attempts: pnpm install $@"
        if pnpm install "$@"; then
            return 0
        fi

        if [ $attempt -lt $max_attempts ]; then
            echo "pnpm install failed, waiting ${delay}s before retry..."
            sleep $delay
        fi
        attempt=$((attempt + 1))
    done

    echo "pnpm install failed after $max_attempts attempts"
    return 1
}

# This script should be called from the root of the repository

version=$1

cd ./packages/ts-moose-proto
npm version $version --no-git-tag-version
cd ../..

# No frozen lockfile because design-system-base has its package.json updated without changing the lock file
retry_pnpm_install --filter "@514labs/moose-proto" --no-frozen-lockfile
pnpm --filter @514labs/moose-proto run gen
pnpm --filter @514labs/moose-proto run build

cd packages/ts-moose-proto
# For CI builds (TAG_LATEST=false), publish with version-specific tag
# For release builds (TAG_LATEST=true), publish and update the 'latest' tag
if [ "${TAG_LATEST}" = "true" ]; then
    # Release build - publish and update 'latest' tag
    pnpm publish --access public --no-git-checks
else
    # CI build - publish with dev tag (doesn't update 'latest')
    pnpm publish --access public --no-git-checks --tag dev
fi
