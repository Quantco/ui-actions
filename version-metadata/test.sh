#!/usr/bin/env bash

DEBUG=0

export MOCKING=1
export GITHUB_REPOSITORY="Quantco/ui-actions"
export GITHUB_EVENT_NAME="pull_request" # can also be "push", or "merge_group"
# for the base this should be an actual SHA as this is value is compared to commit SHAs
# using "main" or something similar might break certain things
# shortened SHAs are fine though
export GITHUB_BASE="30de4a10cfbee3a21a30c66b7c83898ae292c8ec"
export GITHUB_HEAD="b292c84af61b832207a4c360ded207462d588e4f"
export GITHUB_EVENT_PATH="./payload.json" # we create a payload.json file which is then read by `@actions/core` using this env var
export INPUT_FILE="./version-metadata/package.json" # maps to `file` input in action.yml
# export INPUT_VERSION_EXTRACTION_OVERRIDE="" # maps to `version-extraction-override` input in action.yml

# you'll likely have to supply a token using `INPUT_TOKEN`, can be done when calling `./test.sh`

# eventName = pull_request: `pull_request.base.sha`` and `pull_request.head.sha`
# eventName = push:         `before` and `after`
# eventName = merge_group:  `merge_group.base_sha` and `merge_group.head_sha`
rm payload.json
cat <<EOF > ./payload.json
{
  "pull_request": {
    "base": {
      "sha": "$GITHUB_BASE"
    },
    "head": {
      "sha": "$GITHUB_HEAD"
    }
  },
  "before": "$GITHUB_BASE",
  "after": "$GITHUB_HEAD",
  "merge_group": {
    "base_sha": "$GITHUB_BASE",
    "head_sha": "$GITHUB_HEAD"
  }
}
EOF

# defined at the top of the file
if [ $DEBUG -eq 1 ]; then
  node --inspect-brk --enable-source-maps dist/index.js
else
  node dist/index.js
fi
