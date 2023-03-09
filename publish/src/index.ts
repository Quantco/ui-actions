import * as coreDefault from '@actions/core'
import { context } from '@actions/github'
import multimatch from 'multimatch'

import { incrementVersion, summary } from './utils'
import {
  incrementTypeSchema,
  relevantFilesSchema,
  packageJsonFilePathSchema,
  latestRegistryVersionSchema,
  versionMetadataJsonSchema
} from './schemas'

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
  // github internally just calls toString on everything, this can lead to confusion, therefore just accepting strings here outright
  setOutput(name: string, value: string) {
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
const incrementType = incrementTypeSchema.parse(core.getInput('increment-type'))
const relevantFilesGlobs = relevantFilesSchema.parse(JSON.parse(core.getInput('relevant-files')))
const packageJsonFilePath = packageJsonFilePathSchema.parse(core.getInput('package-json-file-path'))
const latestRegistryVersion = latestRegistryVersionSchema.parse(core.getInput('latest-registry-version'))
const versionMetadata = versionMetadataJsonSchema.parse(JSON.parse(core.getInput('version-metadata-json')))

const run = () => {
  const relevantFiles = multimatch(versionMetadata.changedFiles.all, relevantFilesGlobs)

  // filled out with "constant" info about repo, base, head, etc.
  const preparedSummary = summary(
    {
      owner: context.repo.owner,
      repo: context.repo.repo,
      base: versionMetadata.commitBase,
      head: versionMetadata.commitHead
    },
    packageJsonFilePath,
    relevantFilesGlobs
  )

  const oldVersion = versionMetadata.oldVersion

  // if the latest published version is the same as the version which version-metadata
  // detected a upgrade to we most likely have a non-linear git history.
  // The following probably happened: (using branches main, A and B)
  // 1. main: 1.0.0
  // 2. A: 1.0.1
  // 3. merge A into main
  //    -> main: 1.0.1 (published 1.0.1)
  // 5. merge main into B
  //    -> B: 1.0.1
  // 6. merge B into main
  //    -> detected upgrade to 1.0.1 in main
  //    -> tried to publish 1.0.1 again (failure)
  const detectedNonLinearHistory = versionMetadata.newVersion === latestRegistryVersion

  if (versionMetadata.changed && !detectedNonLinearHistory) {
    return {
      publish: true,
      version: versionMetadata.newVersion,
      reason: preparedSummary(relevantFiles, versionMetadata, oldVersion, versionMetadata.newVersion, false)
    }
  } else if (relevantFiles.length > 0 || detectedNonLinearHistory) {
    const incrementedVersion = incrementVersion(latestRegistryVersion, incrementType)
    return {
      publish: true,
      version: incrementedVersion,
      reason: preparedSummary(relevantFiles, versionMetadata, oldVersion, incrementedVersion, true)
    }
  } else {
    return {
      publish: false,
      reason: preparedSummary(relevantFiles, versionMetadata, oldVersion, oldVersion, false)
    }
  }
}

try {
  const { publish, version, reason } = run()

  core.setOutput('publish', String(publish))
  if (version) {
    core.setOutput('version', version)
  }
  core.setOutput('reason', reason)

  core.setOutput('json', JSON.stringify({ publish, version, reason }))
} catch (error: any) {
  core.setFailed(error.message)
}
