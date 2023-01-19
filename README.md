# Monorepo for UI related actions

This repo includes the following actions:

- [version-metadata](./version-metadata)
- [publish](./publish)

> This repo uses [pnpm](https://pnpm.io).

## Example

For more detailed explanations see the respective readmes.
Nevertheless here's a minimal example of these actions in use.

```yaml
- id: version-metadata
  uses: Quantco/ui-actions/version-metadata@v1
  with:
    file: lib/package.json
    token: ${{ secrets.GITHUB_TOKEN }}

- name: Determine last published version
  run: |
    echo "CI_PUBLISHED_VERSION=$(npm show <YOUR PACKAGE NAME> version)" >> $GITHUB_ENV
  env:
    NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  
- id: publish
  uses: Quantco/ui-actions/publish@v1
  with:
    increment-type: pre-release
    relevant-files: '[".github/**", "lib/**"]'
    package-json-file-path: lib/package.json
    latest-registry-version: ${{ env.CI_PUBLISHED_VERSION }}
    version-metadata-json: ${{ steps.version-metadata.outputs.json }}

- name: publish npm package
  if: steps.publish.outputs.publish == 'true'
  run: |
    echo "Publishing version ${{ steps.publish.outputs.version }}"
    npm version --git-tag-version false --allow-same-version true ${{ steps.publish.outputs.version }}
    npm publish
  env:
    NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

- name: Create action summary
  run: |
    echo "$SUMMARY" >> $GITHUB_STEP_SUMMARY
  env:
    SUMMARY: ${{ steps.publish.outputs.reason }}
```

## Development

`ui-actions` uses `ui-actions` itself for creating git tags based on the version in the package.json files (see [`.github/workflows/build.yml`](.github/workflows/build.yml)).

Whenever you want to release a new version you just have to increment the version number in **both** `publish/package.json` and `version-metadata/package.json`.

For local testing you can use the `test.sh` files.
