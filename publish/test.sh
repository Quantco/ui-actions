#!/usr/bin/env bash

export MOCKING=1
export GITHUB_REPOSITORY="Quantco/ui-components"
export INPUT_INCREMENT_TYPE="pre-release"
export INPUT_RELEVANT_FILES='[".github/**", "lib/**", "package.json", ".eslintrc.js", "pnpm-workspace.yaml"]'
export INPUT_PACKAGE_JSON_FILE_PATH="./lib/package.json"
export INPUT_LATEST_REGISTRY_VERSION="0.0.40"

# use the version-metadata action to get the version metadata
# and use its output as the input for this action
cd ../version-metadata
json=$(bash test.sh | grep -o '^::set-output name=json::.*$' | sed 's/::set-output name=json:://g')
cd ../publish

export INPUT_VERSION_METADATA_JSON="${json}"

# you'll likely have to supply a token using `INPUT_TOKEN`, can be done when calling `./test.sh`

node dist/index.mjs
