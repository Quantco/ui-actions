#!/usr/bin/env bash

DEBUG=0

export MOCKING=1
export GITHUB_REPOSITORY="Quantco/ui-actions"
export INPUT_INCREMENT_TYPE="pre-release"
export INPUT_RELEVANT_FILES='[".github/**", "lib/**", "package.json", ".eslintrc.js", "pnpm-workspace.yaml"]'
export INPUT_PACKAGE_JSON_FILE_PATH="./version-metadata/package.json"
export INPUT_LATEST_REGISTRY_VERSION="0.0.40"

# use the version-metadata action to get the version metadata
# and use its output as the input for this action
cd ../version-metadata
json=$(bash test.sh | grep -o '^::set-output name=json::.*$' | sed 's/::set-output name=json:://g')
cd ../publish

export INPUT_VERSION_METADATA_JSON="${json}"

# you'll likely have to supply a token using `INPUT_TOKEN`, can be done when calling `./test.sh`

# defined at the top of the file
if [ $DEBUG -eq 1 ]; then
  node --inspect-brk --enable-source-maps dist/index.js
else
  node dist/index.js
fi
