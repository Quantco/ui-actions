import { spawnSync } from 'child_process'
import type { Context } from '@actions/github/lib/context'
import type { getOctokit } from '@actions/github'

export type VersionDiffType = 'major' | 'minor' | 'patch' | 'pre-release'

export type CategorizedChangedFiles = {
  all: string[]
  added: string[]
  modified: string[]
  removed: string[]
  renamed: string[]
}

export type VersionChange = {
  oldVersion: string
  newVersion: string
  type: VersionDiffType
  commit: string
}

export type VersionMetadataResponse =
  | {
      /** Has the version changed since the last time the action was run? */
      changed: false
      /** always the oldest version, if nothing changed this is just the current version */
      oldVersion: string
      /** always the newest version, if nothing changed this is just the current version */
      newVersion: string
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
      /** always the oldest version, if nothing changed this is just the current version */
      oldVersion: string
      /** always the newest version, if nothing changed this is just the current version */
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
  oldVersion: string,
  base: string,
  head: string
): VersionMetadataResponse => {
  if (changes.length === 0) {
    return {
      changed: false,
      oldVersion,
      newVersion: oldVersion,
      changes: [],
      changedFiles,
      commitBase: base,
      commitHead: head
    }
  } else {
    const newVersion = changes[changes.length - 1].newVersion

    // this might happen with a non-linear git history, we treat this as if there are no version changes
    if (newVersion === oldVersion) {
      return {
        changed: false,
        oldVersion,
        newVersion,
        changes: [],
        changedFiles,
        commitBase: base,
        commitHead: head
      }
    }

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
 * This is necessary because the payload for pull requests, pushes and merge queues are different
 *
 * For PRs:
 * - context.payload.pull_request?.base?.sha
 * - context.payload.pull_request?.head?.sha
 *
 * For pushes:
 * - context.payload.before (*)
 * - context.payload.after
 *
 * For merge queues:
 * - context.payload.merge_group?.base_sha
 * - context.payload.merge_group?.head_sha
 *
 * (*): For pushes which create a new branch, context.payload.before is all zeroes (40 to be exact), in this case base is returned as undefined
 */
const determineBaseAndHead = (context: Context) => {
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

      // when pushing a new branch, the case commit sha is all zeroes (40 to be exact)
      // don't think this is all too correct but it's what the payload looks like
      // (additionally the GITHUB_BASE_REF env variable is empty)
      if (base === '0'.repeat(40)) {
        base = undefined
      }
      break
    case 'merge_group':
      base = context.payload.merge_group?.base_sha
      head = context.payload.merge_group?.head_sha
      break
    default:
      throw new Error(
        `This action only supports pull requests, pushes and merge_groups. ${context.eventName} events are not supported. ` +
          "Please submit an issue on this action's GitHub repo if you believe this in correct."
      )
  }

  // Ensure that the base and head properties are set on the payload.
  if (!head) {
    throw new Error(
      `The base and head commits are missing from the payload for this ${context.eventName} event. ` +
        "Please submit an issue on this action's GitHub repo."
    )
  }

  return { base, head }
}

/**
 * Gets the SHA of the (first) parent commit of a commit
 *
 * This assumes that only one parent exists for the specified commit.
 */
const getParentCommitSha = (octokit: ReturnType<typeof getOctokit>, context: Context, ref: string) =>
  octokit.rest.repos
    .getCommit({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref
    })
    .then((res) => res.data.parents[0].sha)

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

const categorizeChangedFiles = (
  changedFiles: {
    status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged'
    filename: string
  }[]
) => {
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
  return { all, added, modified, removed, renamed }
}

const parseVersionFromFileContentsJSON = (
  fileContent: string,
  sha: string,
  gitUrl: string | null
): { success: false; error: string } | { success: true; version: string } => {
  let parsed: { version?: string }
  try {
    parsed = JSON.parse(fileContent)
  } catch (error) {
    return {
      success: false,
      error: `Failed to parse JSON of package.json file (url: ${gitUrl}, sha: ${sha}, content: "${fileContent}")`
    }
  }
  if (!parsed.version) {
    return {
      success: false,
      error: `version is undefined, this should not happen (url: ${gitUrl}, sha: ${sha})`
    }
  }

  return { success: true, version: parsed.version }
}

const parseVersionFromFileContentsRegex = (
  fileContent: string,
  sha: string,
  gitUrl: string | null,
  regex: RegExp
): { success: false; error: string } | { success: true; version: string } => {
  const maybeVersionMatch = fileContent.match(regex)
  if (!maybeVersionMatch) {
    return {
      success: false,
      error: `Failed to extract version from file contents (url: ${gitUrl}, sha: ${sha}, content: "${fileContent}")`
    }
  }

  const maybeVersion = (maybeVersionMatch[1] || '').trim()

  if (!/^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9]+))?$/.test(maybeVersion)) {
    return {
      success: false,
      error: `Provided regex failed to extract a valid version from file contents (url: ${gitUrl}, sha: ${sha}, match: "${maybeVersion}", content: "${fileContent}")`
    }
  }

  return { success: true, version: maybeVersion }
}

const parseVersionFromFileContentsCommand = (
  fileContent: string,
  sha: string,
  gitUrl: string | null,
  command: string
): { success: false; error: string } | { success: true; version: string } => {
  const child = spawnSync(command, [], {
    input: fileContent,
    encoding: 'utf-8'
  })

  if (child.error) {
    return {
      success: false,
      error: `Failed to execute command (url: ${gitUrl}, sha: ${sha}, error: ${child.error})`
    }
  }

  if (child.status !== 0) {
    return {
      success: false,
      error: `command exited with non-zero status code (url: ${gitUrl}, sha: ${sha}, status: ${child.status}, stderr: ${child.stderr})`
    }
  }

  const maybeVersion = child.stdout.trim()

  if (!/^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9]+))?$/.test(maybeVersion)) {
    return {
      success: false,
      error: `Provided command failed to extract a valid version from file contents (url: ${gitUrl}, sha: ${sha}, output: "${maybeVersion}", content: "${fileContent}")`
    }
  }

  return { success: true, version: maybeVersion }
}

const parseVersionFromFileContents = (
  fileContent: string,
  sha: string,
  gitUrl: string | null,
  extraction: { type: 'json' } | { type: 'regex'; regex: RegExp } | { type: 'command'; command: string }
): { success: false; error: string } | { success: true; version: string } => {
  switch (extraction.type) {
    case 'json':
      return parseVersionFromFileContentsJSON(fileContent, sha, gitUrl)
    case 'regex':
      return parseVersionFromFileContentsRegex(fileContent, sha, gitUrl, extraction.regex)
    case 'command':
      return parseVersionFromFileContentsCommand(fileContent, sha, gitUrl, extraction.command)
  }
}

export {
  parseSemverVersion,
  getSemverDiffType,
  computeResponseFromChanges,
  determineBaseAndHead,
  getParentCommitSha,
  deduplicateConsecutive,
  categorizeChangedFiles,
  parseVersionFromFileContents
}
