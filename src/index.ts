import { normalize } from 'path'
import * as coreDefault from '@actions/core'
import { context, getOctokit } from '@actions/github'

const coreMocked = {
  setFailed: (msg: string) => {
    console.error(msg)
    process.exit(1)
  },
  getInput: (name: string) => {
    const value = process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`]
    if (value === undefined) {
      throw new Error(`Input required and not supplied: ${name}`)
    }
    return value
  },
  setOutput(name: string, value: string) {
    // this is the deprecated format for saving outputs in actions using commands only
    // just using it here to have some sort of consistent output format
    console.log(`::set-output name=${name}::${value}`)
  }
}

const core = process.env.MOCKING ? coreMocked : coreDefault

type VersionDiffType = 'major' | 'minor' | 'patch' | 'pre-release'

type CategorizedChangedFiles = {
  all: string[]
  added: string[]
  modified: string[]
  removed: string[]
  renamed: string[]
}

type VersionChange = {
  oldVersion: string
  newVersion: string
  type: VersionDiffType
  commit: string
}

type VersionMetadataResponse =
  | {
      /** Has the version changed since the last time the action was run? */
      changed: false
      /** commit SHA of the base commit (previous head before pushing / merging new commits) */
      commitBase: string
      /** commit SHA of the head commit */
      commitHead: string
      /** List of all changes to the version number since the last time the action was run. This includes old version, new version, type of change, and the commit SHA for each change */
      changes: never[]
      /** All files changed between the examined commits, categorized by type (added, modified, removed, renamed, all) */
      changedFiles: CategorizedChangedFiles
    }
  | {
      /** Has the version changed since the last time the action was run? */
      changed: true
      oldVersion: string
      newVersion: string
      /** Has the version changed since the last time the action was run? */
      type: VersionDiffType
      /** The SHA of the commit that last changed the version number */
      commitResponsible: string
      /** commit SHA of the base commit (previous head before pushing / merging new commits) */
      commitBase: string
      /** commit SHA of the head commit */
      commitHead: string
      /** All files changed between the examined commits, categorized by type (added, modified, removed, renamed, all) */
      changedFiles: CategorizedChangedFiles
      /** List of all changes to the version number since the last time the action was run. This includes old version, new version, type of change, and the commit SHA for each change */
      changes: VersionChange[]
    }

/**
 * Parses a semver version string into its components
 * This only supports a somewhat rudimentary semver format with the following components:
 * - major (number; required)
 * - minor (number; required)
 * - patch (number; required)
 * - preRelease (string, optional)
 *
 * Thus:
 * - `major.minor.patch` is supported
 * - `major.minor.patch-preRelease` is supported
 *
 * @example
 * parseSemverVersion('1.0.0') // { major: 1, minor: 0, patch: 0, preRelease: undefined }
 * parseSemverVersion('1.0.0-3') // { major: 1, minor: 0, patch: 0, preRelease: '3' }
 * parseSemverVersion('1.2.3-4') // { major: 1, minor: 2, patch: 3, preRelease: '4' }
 * parseSemverVersion('1.0.0-beta') // { major: 1, minor: 0, patch: 0, preRelease: 'beta' }
 */
const parseSemverVersion = (version: string) => {
  const [major, minor, maybePatch] = version.split('.')
  const [patch, preRelease] = maybePatch.includes('-') ? maybePatch.split('-') : [maybePatch, undefined]

  return {
    major: parseInt(major),
    minor: parseInt(minor),
    patch: parseInt(patch),
    preRelease
  }
}

/**
 * Computes the type of change between two semver versions
 * Supports the same format as `parseSemverVersion`
 *
 * Returns `'equal'` if the versions are equal
 * Otherwise returns the largest change type
 *
 * @example
 * getSemverDiffType('1.0.0', '1.0.0') // 'equal'
 * getSemverDiffType('1.0.0', '1.0.1') // 'patch'
 * getSemverDiffType('1.0.0', '1.1.0') // 'minor'
 * getSemverDiffType('1.0.0', '2.0.0') // 'major'
 * getSemverDiffType('1.0.0', '2.0.4') // 'major'
 * getSemverDiffType('1.0.0', '1.0.0-beta') // 'pre-release'
 * getSemverDiffType('1.0.0-3', '1.0.0-4') // 'pre-release'
 * getSemverDiffType('1.0.0-beta', '1.0.0') // 'pre-release'
 * getSemverDiffType('1.2.3', '1.2.3') // 'equal'
 */
const getSemverDiffType = (versionA: string, versionB: string): VersionDiffType | 'equal' => {
  const { major: majorA, minor: minorA, patch: patchA, preRelease: preReleaseA } = parseSemverVersion(versionA)
  const { major: majorB, minor: minorB, patch: patchB, preRelease: preReleaseB } = parseSemverVersion(versionB)

  if (majorA !== majorB) return 'major'
  if (minorA !== minorB) return 'minor'
  if (patchA !== patchB) return 'patch'
  if (preReleaseA !== preReleaseB) return 'pre-release'

  if (versionA === versionB) return 'equal'

  throw new Error(
    `Could not determine the type of change between '${versionA}' and '${versionB}', this should not happen`
  )
}

const computeResponseFromChanges = (
  changes: VersionChange[],
  changedFiles: CategorizedChangedFiles,
  base: string,
  head: string
): VersionMetadataResponse => {
  if (changes.length === 0) {
    return { changed: false, changes: [], changedFiles, commitBase: base, commitHead: head }
  } else {
    const oldVersion = changes[0].oldVersion
    const newVersion = changes[changes.length - 1].newVersion
    return {
      changed: true,
      oldVersion,
      newVersion,
      // we know that the versions differ, therefore we can safely assume that the type is not 'equal'
      type: getSemverDiffType(oldVersion, newVersion) as VersionDiffType,
      commitResponsible: changes[changes.length - 1].commit,
      commitBase: base,
      commitHead: head,
      changes,
      changedFiles
    }
  }
}

/**
 * Determines the base and head commits from the payload
 *
 * This is necessary because the payload for pull requests and pushes are different
 *
 * For PRs:
 * - context.payload.pull_request?.base?.sha
 * - context.payload.pull_request?.head?.sha
 *
 * For pushes:
 * - context.payload.before
 * - context.payload.after
 */
const determineBaseAndHead = () => {
  // Define the base and head commits to be extracted from the payload.
  let base: string | undefined
  let head: string | undefined

  switch (context.eventName) {
    case 'pull_request':
      base = context.payload.pull_request?.base?.sha
      head = context.payload.pull_request?.head?.sha
      break
    case 'push':
      base = context.payload.before
      head = context.payload.after
      break
    default:
      throw new Error(
        `This action only supports pull requests and pushes, ${context.eventName} events are not supported. ` +
          "Please submit an issue on this action's GitHub repo if you believe this in correct."
      )
  }

  // Ensure that the base and head properties are set on the payload.
  if (!base || !head) {
    throw new Error(
      `The base and head commits are missing from the payload for this ${context.eventName} event. ` +
        "Please submit an issue on this action's GitHub repo."
    )
  }

  return { base, head }
}

/**
 * deduplicates consecutive elements in an array
 * Consecutive elements are determined by the result of the accessor function, meaning that it is
 * possible to determine equality based on a property of the element instead of the element itself.
 *
 * @example
 * const arr = [1, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5, 1, 2]
 * const deduplicated = arr.reduce(deduplicateConsecutive((x) => x), { list: [], last: undefined }).list // [1, 2, 3, 4, 5, 1, 2]
 */
const deduplicateConsecutive =
  <T, E>(accessor: (input: T) => E) =>
  (acc: { list: T[]; last: E | undefined }, curr: T) => {
    const value = accessor(curr)
    if (!value) return acc
    if (acc.last === value) return acc

    return { list: [...acc.list, curr], last: value }
  }

/// --- MAIN ---

// deal with inputs of the github action
const packageJsonFile = normalize(core.getInput('file') || 'package.json')
const token = core.getInput('token')

if (!token) {
  core.setFailed('No token provided, the action needs a token to be able to access the GitHub API (octokit)')
}

async function run() {
  // octokit is the GitHub API client
  // reference: https://octokit.github.io/rest.js/v19
  // Goto type definition and looking around isn't all that useful as the types are auto-generated and
  // basically describe the response types of a lot of rest calls using a lot of generic wrapper types.
  //
  // What works great however is auto-completion in the editor as the types for concrete objects are
  // all resolved correctly, just not "the bigger picture" (meaning all useful types in one place).
  const octokit = getOctokit(token)

  const { base, head } = determineBaseAndHead()

  // a lot of metadata about the files changed in between the base and head commits, the commits in between themselves, ...
  const commitDiff = await octokit.rest.repos.compareCommits({
    base,
    head,
    owner: context.repo.owner,
    repo: context.repo.repo
  })

  // all changed files, categorized by type (added, modified, removed, renamed)
  const changedFiles = commitDiff.data.files

  if (!changedFiles) {
    throw new Error('could not retrieve files changed in between base and head commits, aborting')
  }

  const all: string[] = []
  const added: string[] = []
  const modified: string[] = []
  const removed: string[] = []
  const renamed: string[] = []
  for (const file of changedFiles) {
    all.push(file.filename)
    switch (file.status) {
      case 'added':
        added.push(file.filename)
        break
      case 'modified':
        modified.push(file.filename)
        break
      case 'removed':
        removed.push(file.filename)
        break
      case 'renamed':
        renamed.push(file.filename)
        break
    }
  }
  const changedFilesCategorized = { all, added, modified, removed, renamed }

  // filter merge commits as they disrupt the versioning logic (they contain all changes of the PR again)
  const commits = commitDiff.data.commits.filter((commit) => commit.parents.length === 1)

  // all versions of the package.json file in between the base and head commits
  // this has a lot of duplicates, as the file doesn't necessarily change in each commit
  const maybeAllIterationsOfPackageJson = await Promise.all(
    commits.map((commit) =>
      octokit.rest.repos
        .getContent({ owner: context.repo.owner, repo: context.repo.repo, path: packageJsonFile, ref: commit.sha })
        .then((response) => ({ sha: commit.sha, response }))
    )
  )

  const failedRequests = maybeAllIterationsOfPackageJson.filter(({ response }) => response.status !== 200)
  if (failedRequests.length > 0) {
    const failedSHAs = failedRequests.map(({ sha }) => sha).join(', ')
    throw new Error(`could not retrieve all versions of "${packageJsonFile}" (${failedSHAs}), aborting`)
  }

  type NarrowedGetContentResponse = {
    type: string
    size: number
    name: string
    path: string
    content?: string | undefined
    sha: string
    url: string
    git_url: string | null
    html_url: string | null
    download_url: string | null
    // _links: ...
  }

  // can now assert that all requests were successful, as the status code is 200
  const allIterationsOfPackageJson = maybeAllIterationsOfPackageJson.map(({ response, sha }) => ({
    ...response.data,
    sha
  })) as NarrowedGetContentResponse[]

  // remove duplicates from `allIterationsOfPackageJson`
  const deduplicatedVersionsOfPackageJson = allIterationsOfPackageJson.reduce(
    deduplicateConsecutive((x) => x.content),
    { list: [], last: undefined }
  ).list

  const allVersionsOfPackageJson = deduplicatedVersionsOfPackageJson.map(({ content, sha, git_url: gitUrl }) => {
    if (!content) throw new Error(`content is undefined, this should not happen (url: ${gitUrl}, sha: ${sha})`)
    let parsed: { version?: string }
    try {
      parsed = JSON.parse(Buffer.from(content, 'base64').toString())
    } catch (error) {
      throw new Error(`Failed to parse JSON of package.json file (url: ${gitUrl}, sha: ${sha}, content: "${content}")`)
    }
    if (!parsed.version) throw new Error(`version is undefined, this should not happen (url: ${gitUrl}, sha: ${sha})`)

    return { version: parsed.version, sha }
  })

  const deduplicatedVersions = allVersionsOfPackageJson.reduce(
    deduplicateConsecutive((x) => x.version),
    { list: [], last: undefined }
  ).list

  // construct changes array from deduplicatedVersions
  // this works by going over the array and for each pair of consecutive versions constructing a VersionChange object
  const changes = deduplicatedVersions.reduce(
    (acc, curr, index) => {
      if (index === 0) return { list: [] as VersionChange[], last: curr }
      if (!acc.last) throw new Error('acc.last is undefined, this should not happen')

      const versionChange: VersionChange = {
        oldVersion: acc.last.version,
        newVersion: curr.version,
        // we previously deduplicated consecutive versions, this means the diff type cannot be 'equal'
        type: getSemverDiffType(acc.last.version, curr.version) as VersionDiffType,
        commit: curr.sha
      }
      return { list: [...acc.list, versionChange], last: curr }
    },
    { list: [] as VersionChange[], last: undefined as { version: string; sha: string } | undefined }
  ).list

  return computeResponseFromChanges(changes, changedFilesCategorized, base, head)
}

run()
  .then((response) => {
    // common outputs shared by both responses with and without version changes
    core.setOutput('changed', response.changed.toString())
    core.setOutput('commitBase', response.commitBase)
    core.setOutput('commitHead', response.commitHead)
    core.setOutput('changedFiles', JSON.stringify(response.changedFiles))
    core.setOutput('changes', JSON.stringify(response.changes))
    core.setOutput('json', JSON.stringify(response))

    // output only present if there are version changes
    if (response.changed) {
      core.setOutput('type', response.type)
      core.setOutput('oldVersion', response.oldVersion)
      core.setOutput('newVersion', response.newVersion)
      core.setOutput('commitResponsible', response.commitResponsible)
    }
  })
  .catch((error) => core.setFailed(error.message))
