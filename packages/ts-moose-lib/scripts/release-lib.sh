#/usr/bin/env bash

set -eo pipefail

# This script should be called from the root of the repository

version=$1

cd ./packages/ts-moose-lib
npm version $version --no-git-tag-version
cd ../..

# # This is run twice since the change the value of the dependencies in the previous step
pnpm install --filter "@514labs/moose-lib" --no-frozen-lockfile # requires optional dependencies to be present in the registry
pnpm build --filter @514labs/moose-lib

cd packages/ts-moose-lib
# For CI builds (TAG_LATEST=false), publish without updating any tags
# For release builds (TAG_LATEST=true), publish and update the 'latest' tag
if [ "${TAG_LATEST}" = "true" ]; then
    # Release build - publish and update 'latest' tag
    pnpm publish --access public --no-git-checks
else
    # CI build - publish without updating any dist-tags
    pnpm publish --access public --no-git-checks --no-tag
fi