#!/usr/bin/env bash

export MOCKING=1
export GITHUB_REPOSITORY="Quantco/ui-components"
export GITHUB_EVENT_NAME="pull_request"
export GITHUB_BASE="929f3d044ac9a8a7be8e8b0d267942ca38ba95a0"
export GITHUB_HEAD="main"
export GITHUB_EVENT_PATH="./payload.json"
export INPUT_FILE="./lib/package.json"

# pull_request.base.sha and pull_request.head.sha are for eventName = pull_request
# before and after are for eventName = push
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

node dist/index.mjs
