const sequentialPromises = async (promises) => {
  const results = []

  for (const fn of promises) {
    results.push(await fn())
  }

  return results
}

const runTest = (test) => {
  process.env.MOCKING = 1
  process.env.GITHUB_REPOSITORY = test.repo
  process.env.GITHUB_EVENT_NAME = test.event
  process.env.GITHUB_BASE = test.base
  process.env.GITHUB_HEAD = test.head
  process.env.GITHUB_EVENT_PATH = '../payload.json'
  process.env.INPUT_FILE = test.file

  if (test.extractor) {
    process.env.INPUT_VERSION_EXTRACTION_OVERRIDE = test.extractor
  } else {
    delete process.env.INPUT_VERSION_EXTRACTION_OVERRIDE
  }

  const payload = {
    pull_request: {
      base: {
        sha: test.base
      },
      head: {
        sha: test.head
      }
    },
    before: test.base,
    after: test.head
  }

  fs.unlinkSync('../payload.json')
  fs.writeFileSync('../payload.json', JSON.stringify(payload))

  return $`node ../dist/index.js`
}

const parseTestResult = (result) => {
  const lines = result.stdout.split('\n').filter((line) => line.startsWith('::set-output name='))
  return lines.reduce((acc, line) => {
    const [name, value] = line.replace('::set-output name=', '').split('::')
    acc[name] = value
    return acc
  }, {})
}

const verifyResult = (parsedResult, test) => {
  const { changed, oldVersion, newVersion } = parsedResult
  const errors = []
  if (changed !== test.expected.changed.toString()) {
    errors.push(
      `expected "changed" to be ${chalk.bold.yellow(test.expected.changed)} but got ${chalk.bold.yellow(changed)}`
    )
  }
  if (oldVersion !== test.expected.oldVersion) {
    errors.push(
      `expected "oldVersion" to be ${chalk.bold.yellow(test.expected.oldVersion)} but got ${chalk.bold.yellow(
        oldVersion
      )}`
    )
  }
  if (newVersion !== test.expected.newVersion) {
    errors.push(
      `expected "newVersion" to be ${chalk.bold.yellow(test.expected.newVersion)} but got ${chalk.bold.yellow(
        newVersion
      )}`
    )
  }

  if (errors.length > 0) {
    return { success: false, errors, parsedResult, test }
  }

  return { success: true, errors: [], parsedResult, test }
}

export const runTests = (tests, verbose) => {
  console.log(chalk.bold.bgMagenta.white(' Running tests... '))
  console.log('')

  sequentialPromises(
    tests.map((test, index) => async () => {
      console.log(chalk.bold.bgBlue.white(` TEST #${index} `) + ' ' + chalk.bold.white(test.description))
      console.log(chalk.white(`  base: ${test.base}`))
      console.log(chalk.white(`  head: ${test.head}`))
      console.log(chalk.white(`  repo: ${test.repo} (${test.event})`))

      const verifiedResult = await runTest(test)
        .then(parseTestResult)
        .then((result) => verifyResult(result, test))
        .catch((error) => {
          // exited with non-zero exit code while running test itself
          return { success: false, errors: [error._stdout] }
        })

      if (!verifiedResult.success) {
        console.log('  ' + chalk.bold.bgRed.white(' failed '))
        console.log(chalk.white(verifiedResult.errors.map((error) => '  - ' + error).join('\n')))
        if (verifiedResult.parsedResult) {
          console.log(chalk.white('  received result:'))
          console.log(
            chalk.white(
              JSON.stringify(verifiedResult.parsedResult, null, 2)
                .split('\n')
                .map((line) => '  ' + line)
                .join('\n')
            )
          )
        }
      } else {
        console.log('  ' + chalk.bgGreen.white(` passed `))
        if (verbose) {
          console.log(chalk.white('  received result:'))
          console.log(
            chalk.white(
              JSON.stringify(verifiedResult.parsedResult, null, 2)
                .split('\n')
                .map((line) => '  ' + line)
                .join('\n')
            )
          )
        }
      }
      console.log('')

      return verifiedResult
    })
  ).then((parsedResults) => {
    const passedTests = parsedResults.filter((result) => result.success)
    const failedTests = parsedResults.filter((result) => !result.success)
    console.log(
      chalk.bold.bgMagenta.white(' Tests complete.  ') +
        ' ' +
        chalk.bold.white(`${passedTests.length} passed, ${failedTests.length} failed`)
    )

    if (failedTests.length > 0) {
      process.exit(1)
    }
  })
}
