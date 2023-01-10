// src/index.ts
import * as coreDefault from "@actions/core";
import { context } from "@actions/github";
import multimatch from "multimatch";

// src/utils.ts
var incrementPreRelease = ([major, minor, patch, preRelease]) => `${major}.${minor}.${patch}-${preRelease !== void 0 ? preRelease + 1 : 0}`;
var incrementVersion = (version, type) => {
  const [major, minor, maybePatch] = version.split(".");
  const [patch, preRelease] = maybePatch.includes("-") ? [maybePatch.split("-")[0], parseInt(maybePatch.split("-")[1])] : [maybePatch, void 0];
  if (Number.isNaN(preRelease)) {
    throw new Error(`Could not increment version ${version}, pre release should be a number`);
  }
  switch (type) {
    case "pre-release":
      return incrementPreRelease([major, minor, patch, preRelease]);
    default:
      throw new Error(`Unknown increment type "${type}"`);
  }
};
var summary = ({ owner, repo, base, head }, packageJsonFilePath2, relevantFilesGlobs2) => (relevantFiles, rawJson, oldVersion, newVersion, didAutoIncrement) => {
  const noNewVersion = `No relevant changes were made since the last time.`;
  const newVersionAutoDetected = `Relevant files were changed which resulted in a version bump from \`${oldVersion}\` to \`${newVersion}\`.

<details>
  <summary>Relevant files</summary>

  <br />

  ${relevantFiles.map((file) => `- ${file}`).join("\n")}

  <sup>What is considered a relevant change? Anything that matches any of the following file globs:</sup><br />
  <sup>${relevantFilesGlobs2.map((fileGlob) => `\`${fileGlob}\``).join(", ")}</sup>

</details>`;
  const newVersionManuallySet = `Version in \`${packageJsonFilePath2}\` was updated from \`${oldVersion}\` to \`${newVersion}\`.
Thus a new version was published.

<details>
  <summary>Relevant files</summary>

  When incrementing the version number manually the relevant files aren't used in the decision making process, nevertheless here they are
  <br />

  ${relevantFiles.map((file) => `- ${file}`).join("\n")}

  <sup>What is considered a relevant change? Anything that matches any of the following file globs:</sup><br />
  <sup>${relevantFilesGlobs2.map((fileGlob) => `\`${fileGlob}\``).join(", ")}</sup>

</details>`;
  const template = (innerText) => `
# publish

<sup>This action checks if the version number has been updated in the repository and gathers a bit of metadata. Visit [ui-actions](https://github.com/Quantco/ui-actions) to get started.</sup>

${innerText}

<details>
  <summary>Raw JSON data</summary>

  \`\`\`json
  ${JSON.stringify(rawJson, null, 2).split("\n").map((line) => `  ${line}`).join("\n")}
  \`\`\`
</details>

<sup>
  Compared
  [\`${base.substring(0, 6)}\`](https://github.com/${owner}/${repo}/commit/${base}) (base)
  with
  [\`${head.substring(0, 6)}\`](https://github.com/${owner}/${repo}/commit/${head}) (head)
</sup>
`;
  const reason = oldVersion === newVersion ? noNewVersion : didAutoIncrement ? newVersionAutoDetected : newVersionManuallySet;
  return template(reason);
};

// src/schemas.ts
import * as z from "zod";
var semverSchema = z.string().refine((value) => /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9]+))?$/.test(value));
var semverDiffTypeSchema = z.enum(["major", "minor", "patch", "pre-release"]);
var incrementTypeSchema = z.enum(["pre-release"]);
var relevantFilesSchema = z.array(z.string());
var packageJsonFilePathSchema = z.string();
var latestRegistryVersionSchema = semverSchema;
var versionMetadataJsonUnchangedSchema = z.object({
  changed: z.literal(false),
  oldVersion: semverSchema,
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
});
var versionMetadataJsonChangedSchema = z.object({
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
});
var versionMetadataJsonSchema = z.union([versionMetadataJsonUnchangedSchema, versionMetadataJsonChangedSchema]);

// src/index.ts
var coreMocked = {
  setFailed: (msg) => {
    console.error(msg);
    process.exit(1);
  },
  getInput: (name) => {
    const value = process.env[`INPUT_${name.replace(/-/g, "_").toUpperCase()}`];
    if (value === void 0) {
      throw new Error(`Input required and not supplied: ${name}`);
    }
    return value;
  },
  setOutput(name, value) {
    console.log(`::set-output name=${name}::${value}`);
  }
};
var core = process.env.MOCKING ? coreMocked : coreDefault;
var incrementType = incrementTypeSchema.parse(core.getInput("increment-type"));
var relevantFilesGlobs = relevantFilesSchema.parse(JSON.parse(core.getInput("relevant-files")));
var packageJsonFilePath = packageJsonFilePathSchema.parse(core.getInput("package-json-file-path"));
var latestRegistryVersion = latestRegistryVersionSchema.parse(core.getInput("latest-registry-version"));
var versionMetadata = versionMetadataJsonSchema.parse(JSON.parse(core.getInput("version-metadata-json")));
var run = () => {
  const relevantFiles = multimatch(versionMetadata.changedFiles.all, relevantFilesGlobs);
  const preparedSummary = summary(
    {
      owner: context.repo.owner,
      repo: context.repo.repo,
      base: versionMetadata.commitBase,
      head: versionMetadata.commitHead
    },
    packageJsonFilePath,
    relevantFilesGlobs
  );
  const oldVersion = versionMetadata.oldVersion;
  if (versionMetadata.changed) {
    return {
      publish: true,
      version: versionMetadata.newVersion,
      reason: preparedSummary(relevantFiles, versionMetadata, oldVersion, versionMetadata.newVersion, false)
    };
  } else if (relevantFiles.length > 0) {
    const incrementedVersion = incrementVersion(latestRegistryVersion, incrementType);
    return {
      publish: true,
      version: incrementedVersion,
      reason: preparedSummary(relevantFiles, versionMetadata, oldVersion, incrementedVersion, true)
    };
  } else {
    return {
      publish: false,
      reason: preparedSummary(relevantFiles, versionMetadata, oldVersion, oldVersion, false)
    };
  }
};
try {
  const { publish, version, reason } = run();
  core.setOutput("publish", String(publish));
  if (version) {
    core.setOutput("version", version);
  }
  core.setOutput("reason", reason);
} catch (error) {
  core.setFailed(error.message);
}
//# sourceMappingURL=index.mjs.map