#/usr/bin/env bash

set -eo pipefail

export node_version=$1
build_target=$2
build_os=$3
build_name=$4

# set the binary name
current_bin="moose-cli"
# derive the OS and architecture from the build matrix name
# note: when split by a hyphen, first part is the OS and the second is the architecture
node_os=$(echo ${build_name} | cut -d '-' -f1)
export node_os
node_arch=$(echo ${build_name} | cut -d '-' -f2)
export node_arch

# set the version

# set the package name
# note: use 'windows' as OS name instead of 'win32'
if [ ${build_os} = "windows-2022" ]; then
    export node_pkg="${current_bin}-windows-${node_arch}"
else
    export node_pkg="${current_bin}-${node_os}-${node_arch}"
fi
# create the package directory
mkdir -p "${node_pkg}/bin"
# generate package.json from the template
envsubst < package.json.tmpl > "${node_pkg}/package.json"
# copy the binary into the package
# note: windows binaries has '.exe' extension
if [ $build_os = "windows-2022" ]; then
    current_bin="${current_bin}.exe"
fi
pwd
ls "../../target/${build_target}/release/${current_bin}"
cp "../../target/${build_target}/release/${current_bin}" "../../target/${build_target}/release/${current_bin}-${build_target}"
cp "../../target/${build_target}/release/${current_bin}" "${node_pkg}/bin"
# publish the package
cd "${node_pkg}"
# For CI builds (TAG_LATEST=false), publish with version-specific tag
# For release builds (TAG_LATEST=true), publish and update the 'latest' tag
if [ "${TAG_LATEST}" = "true" ]; then
    # Release build - publish and update 'latest' tag
    npm publish --access public
else
    # CI build - publish with version as tag (e.g., 0.6.148-ci-2-g9b399a90)
    npm publish --access public --tag "${node_version}"
fi