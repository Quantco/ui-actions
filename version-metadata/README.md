# Version Metadata

![GitHub tag (latest semver)](https://img.shields.io/github/v/tag/Quantco/ui-actions?color=%23000000&label=latest%20version&sort=semver)

This GitHub action checks what the current version number in the package.json file (location can be specified) is, if it changed since the last check and which files were updated in the process.

Using this you can easily automate publishing to a package registry such as NPM or [GPR](https://github.com/features/packages).

This action only computes metadata and doesn't push git tags, publishes a package, creates github releases, etc.


## Usage

### GitHub Workflow

You have to set up a step like this in your workflow (this assumes you've already [checked out](https://github.com/actions/checkout) your repo):

```yml
- id: version # This will be the reference for getting the outputs.
  uses: Quantco/ui-actions/version-metadata@v1 # You can choose the version/branch you prefer.

  with:
    # You can use this to indicate a custom path to your `package.json`. If you keep
    # your package file in the root directory (which is the usual approach) you can
    # omit this. For monorepos something like `./packages/lib/package.json` might be
    # what you want.
    # Default: package.json
    file: ./lib/package.json

    # Needed for both private and public repos as the GitHub api client needs a token
    # to be instantiated.
    token: ${{ secrets.GITHUB_TOKEN }}
```

Let's assume you just merged a pull request into main in which you did the following things:

- commit A
  - increment version from `1.2.2` to `1.2.3`
  - change 3 files in `lib/src/`
- commit B
  - change 2 files in `lib/src`
- commit C
  - increment version from `1.2.3` to `1.2.4`
  - change 3 files in `lib/src/`

The action will output the following:

```yml
changed: true
oldVersion: '1.2.2'
newVersion: '1.2.4'
type: 'patch'
changedFiles: (stringified JSON object)
  all: [ ... ]
  added: [ ... ]
  modifed: [ ... ]
  renamed: [ ... ]
  removed: [ ... ]
changes: (stringified JSON object)
  - { oldVersion: '1.2.2', newVersion: '1.2.3', type: 'patch', commit: 'A' }
  - { oldVersion: '1.2.3', newVersion: '1.2.4', type: 'patch', commit: 'C' }
commitResponsible: 'C'
commitBase: '~A' # SHA of A's **parent**, i.e. the commit before A (TODO: what does this mean for merge commits with 2 parents?)
commitHead: 'C'
json: "{ ... }" # stringified JSON object with all the above properties
```


### Outputs

- `changed`: either "true" or "false", indicates whether the version has changed.
- `oldVersion`: version before changes, current version if nothing changed
- `newVersion`: version after changes, current version if nothing changed
- `type`: type of change (major, minor, patch, pre-release)
- `changes`: array of changes (see below)
- `changedFiles`: categorized list of changed files (see below)
- `commitBase`: commit SHA of the base commit (previous head before pushing / merging new commits)
- `commitHead`: commit SHA of the head commit
- `json`: stringified JSON object with all the above properties

> `type` is only available if `changed` is "true".

`changedFiles` is an object with the following properties:

- all
- added
- modified
- renamed
- removed

each being an array of strings with the relative path of the changed files.

`changes` is an array of objects with the following properties:

- `oldVersion`: version before changes
- `newVersion`: version after changes
- `type`: type of change (major, minor, patch, pre-release)
- `commit`: commit SHA

It contains an entry for each time the version number changed for the commits considered (base and head, base being the previous head before pushing the new commits).

Note that the output might be a bit confusing if multiple merge commits of intertwined pull requests (time-wise) are involved at once.
This is due to how checking the file contents for each commit works, merge commits are fully ignored.

To access these outputs, you need to access the context of the step you previously set up: you can find more info about steps contexts [here](https://help.github.com/en/articles/contexts-and-expression-syntax-for-github-actions#steps-context).

With step id `version` you'll find the outputs at `steps.version.outputs.OUTPUT_NAME`.

```yml
- name: Check if version has been updated
  id: version
  uses: Quantco/ui-actions/version-metadata@v1

- if: steps.version.outputs.changed == 'true'
  run: |
    echo "New version is ${{ steps.version.outputs.newVersion }}"
    echo "Previous version was ${{ steps.version.outputs.oldVersion }}"

- if: steps.version.outputs.changed == 'false'
  run: 'echo "Version has not changed"'
```


## Examples

```yml
# checkout, setup-node, etc. omitted

- name: Check if version has been updated
  id: version
  uses: Quantco/ui-actions/version-metadata@v1

# if version was manually incremented publish it
- name: Publish to NPM
  if: steps.version.outputs.changed == 'true'
  run: |
    npm publish
  with:
    NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }} # needed for GitHub Package Registry, can omit otherwise

# You can use this to determine if auto-incrementing the version and publishing is useful
- name: Output changed files
  run: |
    echo "Changed files: ${{ fromJSON(steps.version.outputs.changedFiles).all }}"
```

## Overriding the version extraction method

There is the possibility to override the extraction method used to get the version number from a file.
This should be used sparingly as this is not an officially supported feature and might break in the future.

To do so use the `version-extraction-override` input and set it to one of the following values:

- `regex:<the regex matching the version number>`
- `command:<the command that extracts the version number>`

The regex is matched against the contents of the file and is expected to match a valid version number.
The command is given the file contents via stdin and is expected to return a valid version number on stdout.

### Regex example

For this example we'll use a yaml file like this:

```yml
package:
  version: 1.2.3
```

Then you could use the following inputs:

```yml
- name: Check if version has been updated
  id: version
  uses: Quantco/ui-actions/version-metadata@v1
  with:
    file: ./version.yml
    version-extraction-override: 'regex:version: (.*)'
```

### Command example

It is also possible to use a command to extract the version number.

Let's use the yaml file as an example again but this time use [`yq`](https://github.com/mikefarah/yq) to extract the version number:

```yml
package:
  version: 1.2.3
```

You can then use this script in the action:

```yml
- name: Check if version has been updated
  id: version
  uses: Quantco/ui-actions/version-metadata@v1
  with:
    file: ./version.yml
    version-extraction-override: 'command:yq .package.version -'
```


## Local testing

In order to test this locally you can use the `test.sh` script.
It sets a few environment variables which are used by `@actions/core` to mock the GitHub API.
Change these variables to your liking.

```sh
INPUT_TOKEN="<TOKEN>" ./test.sh
```

The `MOCKING` environment variable is checked by `src/index.ts` to determine whether to use the mocked API or the real one.

> **Hint**: if you just want to see the json output you can use
> ```sh
> INPUT_TOKEN="<TOKEN>" ./test.sh | grep -o '^::set-output name=json::.*$' | sed 's/::set-output name=json:://g' | jq
> ```


## License

This action is distributed under the MIT license, check the [license](../LICENSE) for more info.
