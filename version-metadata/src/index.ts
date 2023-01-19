import { normalize } from 'path'
import * as coreDefault from '@actions/core'
import { context, getOctokit } from '@actions/github'
import {
  getSemverDiffType,
  computeResponseFromChanges,
  determineBaseAndHead,
  deduplicateConsecutive,
  categorizeChangedFiles
} from './utils'
import type { VersionDiffType, VersionChange, VersionMetadataResponse } from './utils'

// --- MOCKING ---

const coreMocked = {
  setFailed: (msg: string) => {
    coreMocked.error(msg)
    process.exit(1)
  },
  getInput: (name: string) => {
    const value = process.env[`INPUT_${name.replace(/-/g, '_').toUpperCase()}`]
    if (value === undefined) {
      throw new Error(`Input required and not supplied: ${name}`)
    }
    return value
  },
  setOutput(name: string, value: string | number | boolean) {
    // this is the deprecated format for saving outputs in actions using commands only
    // just using it here to have some sort of consistent output format
    console.log(`::set-output name=${name}::${value}`)
  },
  info: (msg: string) => console.log(`\u001B[44m\u001B[37m I \u001B[39m\u001B[49m ` + msg), // blue "I"
  debug: (msg: string) => console.log(`\u001B[45m\u001B[37m D \u001B[39m\u001B[49m ` + msg), // magenta "D"
  warning: (msg: string) => console.warn(`\u001B[43m\u001B[37m W \u001B[39m\u001B[49m ` + msg), // yellow "W"
  notice: (msg: string) => console.info(`\u001B[44m\u001B[37m ? \u001B[39m\u001B[49m ` + msg), // blue "?"
  error: (msg: string) => console.error(`\u001B[41m\u001B[37m E \u001B[39m\u001B[49m ` + msg), // red "E"
  startGroup: (label: string) => console.group(`\u001B[47m\u001B[30m ▼ \u001B[39m\u001B[49m ` + label), // white "▼"
  endGroup: () => console.groupEnd()
}

const core = process.env.MOCKING ? coreMocked : coreDefault

/// --- MAIN ---

// deal with inputs of the github action
const packageJsonFile = normalize(core.getInput('file') || 'package.json')
const token = core.getInput('token')

async function run(): Promise<VersionMetadataResponse> {
  // octokit is the GitHub API client
  // reference: https://octokit.github.io/rest.js/v19
  // Goto type definition and looking around isn't all that useful as the types are auto-generated and
  // basically describe the response types of a lot of rest calls using a lot of generic wrapper types.
  //
  // What works great however is auto-completion in the editor as the types for concrete objects are
  // all resolved correctly, just not "the bigger picture" (meaning all useful types in one place).
  const octokit = getOctokit(token)

  const { base, head } = determineBaseAndHead(context)

  core.info(`base SHA: ${base}`)
  core.info(`head SHA: ${head}`)

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

  const changedFilesCategorized = categorizeChangedFiles(changedFiles)

  // the base commit is not included in the usual list of commits, it is however provided separately
  const unfilteredCommits = [commitDiff.data.base_commit, ...commitDiff.data.commits]

  // filter merge commits as they disrupt the versioning logic (they contain all changes of the PR again), we still need to include the base commit regardless
  // note: when doing local testing it might happen that shortened SHAs (or "main" / ..) are used, this is
  // able to deal with shortened SHAs because of the `startsWith` check but not with other kinds of refs.
  const commits = unfilteredCommits.filter((commit) => commit.parents.length === 1 || commit.sha.startsWith(base))

  core.startGroup('commits')
  commits.forEach((commit) => {
    core.info(`- ${commit.sha}: ${commit.commit.message.split('\n')[0].trim()}`)
  })
  core.endGroup()

  // all versions of the package.json file in between the base and head commits
  // this has a lot of duplicates, as the file doesn't necessarily change in each commit
  const maybeAllIterationsOfPackageJson = await Promise.all(
    commits.map((commit) =>
      octokit.rest.repos
        .getContent({ owner: context.repo.owner, repo: context.repo.repo, path: packageJsonFile, ref: commit.sha })
        .then((response) => ({ sha: commit.sha, response }))
        .catch((error) => {
          throw new Error(`could not retrieve package.json file from commit ${commit.sha}: ${error.message}`)
        })
    )
  )

  core.debug('all iterations of package.json:')
  maybeAllIterationsOfPackageJson.forEach((iteration) => {
    core.debug(`- ${iteration.sha}: ${JSON.stringify(iteration.response)}`)
  })

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

  // parse the contents of all the package.json files and map { version, sha } each time
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

  core.startGroup('all versions of package.json')
  deduplicatedVersions.forEach(({ sha, version }) => {
    core.info(`- ${sha}: ${version}`)
  })
  core.endGroup()

  const oldVersion = deduplicatedVersions[0].version

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

  return computeResponseFromChanges(changes, changedFilesCategorized, oldVersion, base, head)
}

run()
  .then((response) => {
    // common outputs shared by both responses with and without version changes
    core.setOutput('changed', String(response.changed))
    core.setOutput('oldVersion', response.oldVersion)
    core.setOutput('newVersion', response.newVersion)
    core.setOutput('commitBase', response.commitBase)
    core.setOutput('commitHead', response.commitHead)
    core.setOutput('changedFiles', JSON.stringify(response.changedFiles))
    core.setOutput('changes', JSON.stringify(response.changes))
    core.setOutput('json', JSON.stringify(response))

    // output only present if there are version changes
    if (response.changed) {
      core.setOutput('type', response.type)
      core.setOutput('commitResponsible', response.commitResponsible)
    }
  })
  .catch((error) => core.setFailed(error.message))
