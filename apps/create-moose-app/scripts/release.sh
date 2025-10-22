#/usr/bin/env bash

set -eo pipefail

version=$1

cd apps/create-moose-app
npm version $version --no-git-tag-version

jq \
    --arg VERSION "$version" \
    '.["dependencies"]["@514labs/moose-cli"] = $VERSION' package.json > package.json.tmp \
    && mv package.json.tmp package.json

cd ../..
pnpm build --filter ...create-moose-app
cd apps/create-moose-app
# For CI builds (TAG_LATEST=false), publish with version-specific tag
# For release builds (TAG_LATEST=true), publish and update the 'latest' tag
if [ "${TAG_LATEST}" = "true" ]; then
    # Release build - publish and update 'latest' tag
    pnpm publish --access public --no-git-checks
else
    # CI build - publish with version as tag (e.g., 0.6.148-ci-2-g9b399a90)
    pnpm publish --access public --no-git-checks --tag "${version}"
fi