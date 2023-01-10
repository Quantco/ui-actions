#!/usr/bin/env bash

export MOCKING=1
export GITHUB_REPOSITORY="Quantco/ui-components"
export GITHUB_EVENT_NAME="pull_request" # can also be "push"
export GITHUB_BASE="929f3d044ac9a8a7be8e8b0d267942ca38ba95a0"
export GITHUB_HEAD="main" # preferably a SHA as github provides those
export GITHUB_EVENT_PATH="./payload.json" # we create a payload.json file which is then read by `@actions/core` using this env var
export INPUT_FILE="./lib/package.json" # maps to `file` input in action.yml

# you'll likely have to supply a token using `INPUT_TOKEN`, can be done when calling `./test.sh`

# eventName = pull_request: `pull_request.base.sha`` and `pull_request.head.sha`
# eventName = push:         `before` and `after`
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
  "after": "$GITHUB_HEAD"
}
EOF

node dist/index.js
