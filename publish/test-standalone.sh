#!/usr/bin/env bash

DEBUG=0

# in comparison to `test.sh` this file is not invoking `version-metadata` to get the json output
# but instead has it "hardcoded" here.
# this allows testing more obscure scenarios such as malformed json or missing fields
export MOCKING=1
export GITHUB_REPOSITORY="Quantco/ui-actions"
export INPUT_INCREMENT_TYPE="pre-release"
export INPUT_RELEVANT_FILES='[".github/**", "lib/**", "package.json", ".eslintrc.js", "pnpm-workspace.yaml"]'
export INPUT_PACKAGE_JSON_FILE_PATH="./version-metadata/package.json"
export INPUT_LATEST_REGISTRY_VERSION="0.0.40"
export INPUT_VERSION_METADATA_JSON=$(
  cat << EOF
{
  "changed": true,
  "oldVersion": "1.0.4",
  "newVersion": "1.0.5",
  "type": "patch",
  "commitResponsible": "b292c84af61b832207a4c360ded207462d588e4f",
  "commitBase": "30de4a10cfbee3a21a30c66b7c83898ae292c8ec",
  "commitHead": "b292c84af61b832207a4c360ded207462d588e4f",
  "changes": [
    {
      "oldVersion": "1.0.4",
      "newVersion": "1.0.5",
      "type": "patch",
      "commit": "b292c84af61b832207a4c360ded207462d588e4f"
    }
  ],
  "changedFiles": {
    "all": [
      ".github/workflows/build.yml",
      "publish/README.md",
      "publish/dist/index.js",
      "publish/dist/index.js.map",
      "publish/images/case-1-dark.svg",
      "publish/images/case-2-dark.svg",
      "publish/images/case-3-dark.svg",
      "publish/images/decision-tree-dark.svg",
      "publish/package.json",
      "publish/src/schemas.ts",
      "version-metadata/README.md",
      "version-metadata/action.yml",
      "version-metadata/dist/index.js",
      "version-metadata/dist/index.js.map",
      "version-metadata/package.json",
      "version-metadata/src/index.ts",
      "version-metadata/src/utils.ts"
    ],
    "added": [
      "publish/images/case-1-dark.svg",
      "publish/images/case-2-dark.svg",
      "publish/images/case-3-dark.svg",
      "publish/images/decision-tree-dark.svg"
    ],
    "modified": [
      ".github/workflows/build.yml",
      "publish/README.md",
      "publish/dist/index.js",
      "publish/dist/index.js.map",
      "publish/package.json",
      "publish/src/schemas.ts",
      "version-metadata/README.md",
      "version-metadata/action.yml",
      "version-metadata/dist/index.js",
      "version-metadata/dist/index.js.map",
      "version-metadata/package.json",
      "version-metadata/src/index.ts",
      "version-metadata/src/utils.ts"
    ],
    "removed": [],
    "renamed": []
  }
}
EOF
)

# defined at the top of the file
if [ $DEBUG -eq 1 ]; then
  node --inspect-brk --enable-source-maps dist/index.js
else
  node dist/index.js
fi
