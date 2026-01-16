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

cd ./packages/ts-connector-s3
npm version $version --no-git-tag-version

# Update the peer dependency version to match this package version
# Use platform-specific sed command
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS (BSD sed)
  sed -i '' "s/\"@514labs\/moose-lib\": \"\*\"/\"@514labs\/moose-lib\": \"\^$version\"/" package.json
else
  # Linux (GNU sed)
  sed -i "s/\"@514labs\/moose-lib\": \"\*\"/\"@514labs\/moose-lib\": \"\^$version\"/" package.json
fi

cd ../..

# This is run twice since the change the value of the dependencies in the previous step
retry_pnpm_install --filter "@514labs/moose-connector-s3" --no-frozen-lockfile # requires optional dependencies to be present in the registry
pnpm build --filter @514labs/moose-connector-s3

cd packages/ts-connector-s3
# For CI builds (TAG_LATEST=false), publish with version-specific tag
# For release builds (TAG_LATEST=true), publish and update the 'latest' tag
if [ "${TAG_LATEST}" = "true" ]; then
    # Release build - publish and update 'latest' tag
    pnpm publish --access public --no-git-checks
else
    # CI build - publish with dev tag (doesn't update 'latest')
    pnpm publish --access public --no-git-checks --tag dev
fi