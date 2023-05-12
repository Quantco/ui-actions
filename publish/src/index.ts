import * as coreDefault from '@actions/core'
import { context } from '@actions/github'
import multimatch from 'multimatch'

import { incrementVersion, summary } from './utils'
import {
  incrementTypeSchema,
  relevantFilesSchema,
  packageJsonFilePathSchema,
  latestRegistryVersionSchema,
  versionMetadataJsonSchema,
  packageNameSchema
} from './schemas'

// --- MOCKING ---
const coreMocked = {
  setFailed: (msg: string) => {
    coreMocked.error(msg)
    process.exit(1)
  },
  getInput: (name: string, options: coreDefault.InputOptions = { required: true, trimWhitespace: true }) => {
    const value = process.env[`INPUT_${name.replace(/-/g, '_').toUpperCase()}`]
    if (options.required) {
      if (value === undefined) {
        throw new Error(`Input required and not supplied: ${name}`)
      }
      if (options.trimWhitespace) {
        return value.trim()
      } else {
        return value
      }
    } else {
      if (value && options.trimWhitespace) {
        return value.trim()
      } else {
        return value
      }
    }
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

// get the inputs once and save them in this object
// re-retreiving them again isn't computationally expensive, but lets still do it only once
const inputs = {
  'increment-type': core.getInput('increment-type', { required: true }) as string,
  'relevant-files': core.getInput('relevant-files', { required: true }) as string,
  'package-json-file-path': core.getInput('package-json-file-path', { required: true }) as string,
  'latest-registry-version': core.getInput('latest-registry-version', { required: true }) as string,
  'version-metadata-json': core.getInput('version-metadata-json', { required: true }) as string,
  'package-name': core.getInput('package-name', { required: false })
}

// check if the inputs containing JSOn are actually valid JSON
try {
  JSON.parse(inputs['relevant-files'])
} catch (err) {
  const received = `- received: \`${inputs['relevant-files']}\``
  const error = `- error: ${err}`
  throw new Error(`Invalid JSON for "relevant-files":\n${received}\n${error}`)
}

try {
  JSON.parse(inputs['version-metadata-json'])
} catch (err) {
  const received = `- received: \`${inputs['version-metadata-json']}\``
  const error = `- error: ${err}`
  throw new Error(`Invalid JSON for "version-metadata-json":\n${received}\n${error}`)
}

// save parse inputs using zod
const maybeIncrementType = incrementTypeSchema.safeParse(inputs['increment-type'])
const maybeRelevantFilesGlobs = relevantFilesSchema.safeParse(JSON.parse(inputs['relevant-files']))
const maybePackageJsonFilePath = packageJsonFilePathSchema.safeParse(inputs['package-json-file-path'])
const maybeLatestRegistryVersion = latestRegistryVersionSchema.safeParse(inputs['latest-registry-version'])
const maybeVersionMetadata = versionMetadataJsonSchema.safeParse(JSON.parse(inputs['version-metadata-json']))
const maybePackageName = packageNameSchema.safeParse(inputs['package-name'])

// output individual errors for each input
if (!maybeIncrementType.success) {
  const received = `- received: \`${inputs['increment-type']}\``
  const formatted = `- formatted: \`${JSON.stringify(maybeIncrementType.error.format())}\``
  const error = `- error: ${JSON.stringify(maybeIncrementType.error)}`
  throw new Error(`Invalid input for "increment-type":\n${received}\n${formatted}\n${error}\n`)
}

if (!maybeRelevantFilesGlobs.success) {
  const received = `- received: \`${inputs['relevant-files']}\``
  const formatted = `- formatted: \`${JSON.stringify(maybeRelevantFilesGlobs.error.format())}\``
  const error = `- error: ${JSON.stringify(maybeRelevantFilesGlobs.error)}`
  throw new Error(`Invalid input for "relevant-files":\n${received}\n${formatted}\n${error}\n`)
}

if (!maybePackageJsonFilePath.success) {
  const received = `- received: \`${inputs['package-json-file-path']}\``
  const formatted = `- formatted: \`${JSON.stringify(maybePackageJsonFilePath.error.format())}\``
  const error = `- error: ${JSON.stringify(maybePackageJsonFilePath.error)}`
  throw new Error(`Invalid input for "package-json-file-path":\n${received}\n${formatted}\n${error}\n`)
}

if (!maybeLatestRegistryVersion.success) {
  const received = `- received: \`${inputs['latest-registry-version']}\``
  const formatted = `- formatted: \`${JSON.stringify(maybeLatestRegistryVersion.error.format())}\``
  const error = `- error: ${JSON.stringify(maybeLatestRegistryVersion.error)}`
  throw new Error(`Invalid input for "latest-registry-version":\n${received}\n${formatted}\n${error}\n`)
}

if (!maybeVersionMetadata.success) {
  const received = `- received: \`${inputs['version-metadata-json']}\``
  const formatted = `- formatted: \`${JSON.stringify(maybeVersionMetadata.error.format())}\``
  const error = `- error: ${JSON.stringify(maybeVersionMetadata.error)}`
  throw new Error(`Invalid input for "version-metadata-json":\n${received}\n${formatted}\n${error}\n`)
}

if (!maybePackageName.success) {
  const received = `- received: \`${inputs['package-name']}\``
  const formatted = `- formatted: \`${JSON.stringify(maybePackageName.error.format())}\``
  const error = `- error: ${JSON.stringify(maybePackageName.error)}`
  throw new Error(`Invalid input for "package-name":\n${received}\n${formatted}\n${error}\n`)
}

const incrementType = maybeIncrementType.data
const relevantFilesGlobs = maybeRelevantFilesGlobs.data
const packageJsonFilePath = maybePackageJsonFilePath.data
const latestRegistryVersion = maybeLatestRegistryVersion.data
const versionMetadata = maybeVersionMetadata.data
const packageName = maybePackageName.data

const run = () => {
  const relevantFiles = multimatch(versionMetadata.changedFiles.all, relevantFilesGlobs)

  // filled out with "constant" info about repo, base, head, etc.
  const preparedSummary = summary(
    {
      owner: context.repo.owner,
      repo: context.repo.repo,
      base: versionMetadata.commitBase,
      head: versionMetadata.commitHead,
      packageName
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
