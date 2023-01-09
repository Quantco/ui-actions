// src/index.ts
import { normalize } from "path";
import * as coreDefault from "@actions/core";
import { context, getOctokit } from "@actions/github";

// src/utils.ts
var parseSemverVersion = (version) => {
  const [major, minor, maybePatch] = version.split(".");
  const [patch, preRelease] = maybePatch.includes("-") ? maybePatch.split("-") : [maybePatch, void 0];
  return {
    major: parseInt(major),
    minor: parseInt(minor),
    patch: parseInt(patch),
    preRelease
  };
};
var getSemverDiffType = (versionA, versionB) => {
  const { major: majorA, minor: minorA, patch: patchA, preRelease: preReleaseA } = parseSemverVersion(versionA);
  const { major: majorB, minor: minorB, patch: patchB, preRelease: preReleaseB } = parseSemverVersion(versionB);
  if (majorA !== majorB)
    return "major";
  if (minorA !== minorB)
    return "minor";
  if (patchA !== patchB)
    return "patch";
  if (preReleaseA !== preReleaseB)
    return "pre-release";
  if (versionA === versionB)
    return "equal";
  throw new Error(
    `Could not determine the type of change between '${versionA}' and '${versionB}', this should not happen`
  );
};
var computeResponseFromChanges = (changes, changedFiles, base, head) => {
  if (changes.length === 0) {
    return { changed: false, changes: [], changedFiles, commitBase: base, commitHead: head };
  } else {
    const oldVersion = changes[0].oldVersion;
    const newVersion = changes[changes.length - 1].newVersion;
    return {
      changed: true,
      oldVersion,
      newVersion,
      type: getSemverDiffType(oldVersion, newVersion),
      commitResponsible: changes[changes.length - 1].commit,
      commitBase: base,
      commitHead: head,
      changes,
      changedFiles
    };
  }
};
var determineBaseAndHead = (context2) => {
  let base;
  let head;
  switch (context2.eventName) {
    case "pull_request":
      base = context2.payload.pull_request?.base?.sha;
      head = context2.payload.pull_request?.head?.sha;
      break;
    case "push":
      base = context2.payload.before;
      head = context2.payload.after;
      break;
    default:
      throw new Error(
        `This action only supports pull requests and pushes, ${context2.eventName} events are not supported. Please submit an issue on this action's GitHub repo if you believe this in correct.`
      );
  }
  if (!base || !head) {
    throw new Error(
      `The base and head commits are missing from the payload for this ${context2.eventName} event. Please submit an issue on this action's GitHub repo.`
    );
  }
  return { base, head };
};
var deduplicateConsecutive = (accessor) => (acc, curr) => {
  const value = accessor(curr);
  if (!value)
    return acc;
  if (acc.last === value)
    return acc;
  return { list: [...acc.list, curr], last: value };
};
var categorizeChangedFiles = (changedFiles) => {
  const all = [];
  const added = [];
  const modified = [];
  const removed = [];
  const renamed = [];
  for (const file of changedFiles) {
    all.push(file.filename);
    switch (file.status) {
      case "added":
        added.push(file.filename);
        break;
      case "modified":
        modified.push(file.filename);
        break;
      case "removed":
        removed.push(file.filename);
        break;
      case "renamed":
        renamed.push(file.filename);
        break;
    }
  }
  return { all, added, modified, removed, renamed };
};

// src/index.ts
var coreMocked = {
  setFailed: (msg) => {
    console.error(msg);
    process.exit(1);
  },
  getInput: (name) => {
    const value = process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`];
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
var packageJsonFile = normalize(core.getInput("file") || "package.json");
var token = core.getInput("token");
async function run() {
  const octokit = getOctokit(token);
  const { base, head } = determineBaseAndHead(context);
  const commitDiff = await octokit.rest.repos.compareCommits({
    base,
    head,
    owner: context.repo.owner,
    repo: context.repo.repo
  });
  const changedFiles = commitDiff.data.files;
  if (!changedFiles) {
    throw new Error("could not retrieve files changed in between base and head commits, aborting");
  }
  const changedFilesCategorized = categorizeChangedFiles(changedFiles);
  const commits = commitDiff.data.commits.filter((commit) => commit.parents.length === 1);
  const maybeAllIterationsOfPackageJson = await Promise.all(
    commits.map(
      (commit) => octokit.rest.repos.getContent({ owner: context.repo.owner, repo: context.repo.repo, path: packageJsonFile, ref: commit.sha }).then((response) => ({ sha: commit.sha, response }))
    )
  );
  const failedRequests = maybeAllIterationsOfPackageJson.filter(({ response }) => response.status !== 200);
  if (failedRequests.length > 0) {
    const failedSHAs = failedRequests.map(({ sha }) => sha).join(", ");
    throw new Error(`could not retrieve all versions of "${packageJsonFile}" (${failedSHAs}), aborting`);
  }
  const allIterationsOfPackageJson = maybeAllIterationsOfPackageJson.map(({ response, sha }) => ({
    ...response.data,
    sha
  }));
  const deduplicatedVersionsOfPackageJson = allIterationsOfPackageJson.reduce(
    deduplicateConsecutive((x) => x.content),
    { list: [], last: void 0 }
  ).list;
  const allVersionsOfPackageJson = deduplicatedVersionsOfPackageJson.map(({ content, sha, git_url: gitUrl }) => {
    if (!content)
      throw new Error(`content is undefined, this should not happen (url: ${gitUrl}, sha: ${sha})`);
    let parsed;
    try {
      parsed = JSON.parse(Buffer.from(content, "base64").toString());
    } catch (error) {
      throw new Error(`Failed to parse JSON of package.json file (url: ${gitUrl}, sha: ${sha}, content: "${content}")`);
    }
    if (!parsed.version)
      throw new Error(`version is undefined, this should not happen (url: ${gitUrl}, sha: ${sha})`);
    return { version: parsed.version, sha };
  });
  const deduplicatedVersions = allVersionsOfPackageJson.reduce(
    deduplicateConsecutive((x) => x.version),
    { list: [], last: void 0 }
  ).list;
  const changes = deduplicatedVersions.reduce(
    (acc, curr, index) => {
      if (index === 0)
        return { list: [], last: curr };
      if (!acc.last)
        throw new Error("acc.last is undefined, this should not happen");
      const versionChange = {
        oldVersion: acc.last.version,
        newVersion: curr.version,
        type: getSemverDiffType(acc.last.version, curr.version),
        commit: curr.sha
      };
      return { list: [...acc.list, versionChange], last: curr };
    },
    { list: [], last: void 0 }
  ).list;
  return computeResponseFromChanges(changes, changedFilesCategorized, base, head);
}
run().then((response) => {
  core.setOutput("changed", response.changed.toString());
  core.setOutput("commitBase", response.commitBase);
  core.setOutput("commitHead", response.commitHead);
  core.setOutput("changedFiles", JSON.stringify(response.changedFiles));
  core.setOutput("changes", JSON.stringify(response.changes));
  core.setOutput("json", JSON.stringify(response));
  if (response.changed) {
    core.setOutput("type", response.type);
    core.setOutput("oldVersion", response.oldVersion);
    core.setOutput("newVersion", response.newVersion);
    core.setOutput("commitResponsible", response.commitResponsible);
  }
}).catch((error) => core.setFailed(error.message));
//# sourceMappingURL=index.mjs.map