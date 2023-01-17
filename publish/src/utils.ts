import type { VersionMetadataResponse } from './schemas'

type ParsedVersion = [number, number, number, number | undefined]

// if pre-release is already present increment it
// if not, increment patch and add pre-release (defaulting to "-0")
const incrementPreRelease = ([major, minor, patch, preRelease]: ParsedVersion): string => {
  if (preRelease === undefined) {
    return `${major}.${minor}.${patch + 1}-${0}`
  } else {
    return `${major}.${minor}.${patch}-${preRelease + 1}`
  }
}

// increment patch and reset pre-release (empty by default, not adding a "-0")
const incrementPatch = ([major, minor, patch]: ParsedVersion): string => `${major}.${minor}.${patch + 1}`

// increment minor and reset patch (to "0") and pre-release (empty by default, not adding a "-0")
const incrementMinor = ([major, minor]: ParsedVersion): string => `${major}.${minor + 1}.0`

// increment major and reset minor (to "0"), patch (to "0") and pre-release (empty by default, not adding a "-0")
const incrementMajor = ([major]: ParsedVersion): string => `${major + 1}.0.0`

const incrementVersion = (version: string, type: 'pre-release' | 'patch' | 'minor' | 'major') => {
  // we assume that the version is valid, this means that it has the following format:
  // {number}.{number}.{number}
  // -- OR --
  // {number}.{number}.{number}-{number}
  //
  // this is a subset of semver, things such as "-beta" or "-rc.1" are not supported
  const [majorS, minorS, maybePatch] = version.split('.')

  const major = parseInt(majorS)
  const minor = parseInt(minorS)

  const [patch, preRelease] = maybePatch.includes('-')
    ? [parseInt(maybePatch.split('-')[0]), parseInt(maybePatch.split('-')[1])]
    : [parseInt(maybePatch), undefined]

  if (Number.isNaN(preRelease)) {
    throw new Error(`Could not increment version ${version}, pre release should be a number`)
  }

  // TODO: add support for other types
  switch (type) {
    case 'pre-release':
      return incrementPreRelease([major, minor, patch, preRelease])
    case 'patch':
      return incrementPatch([major, minor, patch, preRelease])
    case 'minor':
      return incrementMinor([major, minor, patch, preRelease])
    case 'major':
      return incrementMajor([major, minor, patch, preRelease])
    default:
      throw new Error(`Unknown increment type "${type}"`)
  }
}

const summary =
  (
    { owner, repo, base, head }: { owner: string; repo: string; base: string; head: string },
    packageJsonFilePath: string,
    relevantFilesGlobs: string[]
  ) =>
  (
    relevantFiles: string[],
    rawJson: VersionMetadataResponse,
    oldVersion: string,
    newVersion: string,
    didAutoIncrement: boolean
  ) => {
    // start of with actual content that greatly depends on the decision about publishing, not publishing, etc.
    const noNewVersion = `No relevant changes were made since the last time.`

    const newVersionAutoDetected = `Relevant files were changed which resulted in a version bump from \`${oldVersion}\` to \`${newVersion}\`.

<details>
  <summary>Relevant files</summary>

  <br />

  ${relevantFiles.map((file) => `- ${file}`).join('\n  ')}

  <sup>What is considered a relevant change? Anything that matches any of the following file globs:</sup><br />
  <sup>${relevantFilesGlobs.map((fileGlob) => `\`${fileGlob}\``).join(', ')}</sup>

</details>`

    const newVersionManuallySet = `Version in \`${packageJsonFilePath}\` was updated from \`${oldVersion}\` to \`${newVersion}\`.
Thus a new version was published.

<details>
  <summary>Relevant files</summary>

  When incrementing the version number manually the relevant files aren't used in the decision making process, nevertheless here they are
  <br />

  ${relevantFiles.map((file) => `- ${file}`).join('\n')}

  <sup>What is considered a relevant change? Anything that matches any of the following file globs:</sup><br />
  <sup>${relevantFilesGlobs.map((fileGlob) => `\`${fileGlob}\``).join(', ')}</sup>

</details>`

    // now add the wrapper around it that is the same for all cases
    const template = (innerText: string) => `
# publish

<sup>This action checks if the version number has been updated in the repository and gathers a bit of metadata. Visit [ui-actions](https://github.com/Quantco/ui-actions) to get started.</sup>

${innerText}

<details>
  <summary>Raw JSON data</summary>

  \`\`\`json
  ${
    JSON.stringify(rawJson, null, 2)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n') /* indent each line by 2 spaces */
  }
  \`\`\`
</details>

<sup>
  Compared
  [\`${base.substring(0, 6)}\`](https://github.com/${owner}/${repo}/commit/${base}) (base)
  with
  [\`${head.substring(0, 6)}\`](https://github.com/${owner}/${repo}/commit/${head}) (head)
</sup>
`
    // decide which one to use
    const reason =
      oldVersion === newVersion ? noNewVersion : didAutoIncrement ? newVersionAutoDetected : newVersionManuallySet

    return template(reason)
  }

export { incrementVersion, summary }
