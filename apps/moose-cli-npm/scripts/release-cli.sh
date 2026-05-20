#/usr/bin/env bash

set -eo pipefail

# This script should be called from the root of the repository

version=$1

cd ./apps/moose-cli-npm
npm version $version --no-git-tag-version

# change all the dependencies in the package.json optionalDependencies to use 
# the BUILD version
jq -r '.optionalDependencies | keys[]' package.json | while read dep; do
#   pnpm up $dep $version
  jq \
    --arg DEP "$dep" \
    --arg VERSION "$version" \
    '.["optionalDependencies"][$DEP] = $VERSION' package.json > package.json.tmp \
    && mv package.json.tmp package.json
done
cd ../..

# # This is run twice since the change the value of the dependencies in the previous step
pnpm install --filter "@514labs/moose-cli" --no-frozen-lockfile # requires optional dependencies to be present in the registry
pnpm build --filter @514labs/moose-cli

cd apps/moose-cli-npm
package_name=$(node -p "require('./package.json').name")
package_version=$(node -p "require('./package.json').version")
# For CI builds (TAG_LATEST=false), publish with version-specific tag
# For release builds (TAG_LATEST=true), publish and update the 'latest' tag
if [ "${TAG_LATEST}" = "true" ]; then
    # Release build - publish and update 'latest' tag
    if npm view "${package_name}@${package_version}" version >/dev/null 2>&1; then
        current_latest=$(npm view "${package_name}" dist-tags.latest 2>/dev/null || true)
        if [ "${current_latest}" = "${package_version}" ]; then
            echo "${package_name}@${package_version} is already published and latest already points to it"
            exit 0
        fi

        echo "${package_name}@${package_version} is already published, but latest points to ${current_latest}"
        exit 1
    fi
    pnpm publish --access public --no-git-checks
else
    # CI build - publish with dev tag (doesn't update 'latest')
    if npm view "${package_name}@${package_version}" version >/dev/null 2>&1; then
        echo "${package_name}@${package_version} is already published; skipping publish"
        exit 0
    fi
    pnpm publish --access public --no-git-checks --tag dev
fi
