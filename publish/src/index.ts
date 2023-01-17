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
    console.error(msg)
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
  }
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

  if (versionMetadata.changed) {
    return {
      publish: true,
      version: versionMetadata.newVersion,
      reason: preparedSummary(relevantFiles, versionMetadata, oldVersion, versionMetadata.newVersion, false)
    }
  } else if (relevantFiles.length > 0) {
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
