import * as z from 'zod'

const semverSchema = z.string().refine(
  (value) => /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9]+))?$/.test(value),
  (value) => ({
    message: `Invalid semver version (received: "${value}", expected: major.minor.patch or major.minor.patch-preRelease)`
  })
)
const semverDiffTypeSchema = z.enum(['major', 'minor', 'patch', 'pre-release'])

const incrementTypeSchema = z.enum(['pre-release', 'patch', 'minor', 'major'])
const relevantFilesSchema = z.array(z.string())
const packageJsonFilePathSchema = z.string()
const latestRegistryVersionSchema = semverSchema
const packageNameSchema = z.string().optional()

const versionMetadataJsonUnchangedSchema = z.object({
  changed: z.literal(false),
  oldVersion: semverSchema,
  newVersion: semverSchema,
  commitBase: z.string(),
  commitHead: z.string(),
  changedFiles: z.object({
    all: z.array(z.string()),
    added: z.array(z.string()),
    modified: z.array(z.string()),
    removed: z.array(z.string()),
    renamed: z.array(z.string())
  }),
  changes: z.array(z.never())
})

const versionMetadataJsonChangedSchema = z.object({
  changed: z.literal(true),
  oldVersion: semverSchema,
  newVersion: semverSchema,
  type: semverDiffTypeSchema,
  commitResponsible: z.string(),
  commitBase: z.string(),
  commitHead: z.string(),
  changedFiles: z.object({
    all: z.array(z.string()),
    added: z.array(z.string()),
    modified: z.array(z.string()),
    removed: z.array(z.string()),
    renamed: z.array(z.string())
  }),
  changes: z.array(
    z.object({
      oldVersion: semverSchema,
      newVersion: semverSchema,
      type: semverDiffTypeSchema
    })
  )
})

const versionMetadataJsonSchema = z.union([versionMetadataJsonUnchangedSchema, versionMetadataJsonChangedSchema])

export type SemverDiffType = z.infer<typeof semverDiffTypeSchema>
export type VersionMetadataResponse = z.infer<typeof versionMetadataJsonSchema>

export {
  incrementTypeSchema,
  relevantFilesSchema,
  packageJsonFilePathSchema,
  latestRegistryVersionSchema,
  versionMetadataJsonSchema,
  packageNameSchema
}
