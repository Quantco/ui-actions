#!/usr/bin/env -S npx zx --quiet

import { runTests } from './testrunner.mjs'

if (!process.env.INPUT_TOKEN) {
  console.log(chalk.bold.bgRed.white(' Error ') + ' ' + chalk.bold.white('No INPUT_TOKEN provided'))
  process.exit(1)
}

const tests = [
  {
    description: 'Basic version increment is detected correctly',
    base: '30de4a10cfbee3a21a30c66b7c83898ae292c8ec',
    head: 'b292c84af61b832207a4c360ded207462d588e4f',
    repo: 'Quantco/ui-actions',
    event: 'pull_request',
    file: './version-metadata/package.json',
    expected: {
      changed: true,
      oldVersion: '1.0.4',
      newVersion: '1.0.5'
    }
  },
  {
    description: 'Works on initial commit',
    base: '',
    head: '46ea5e950b3f316954efd022174fa9871ce3a301',
    repo: 'Quantco/ui-actions',
    event: 'push',
    file: './package.json',
    expected: {
      changed: true,
      oldVersion: '0.0.0',
      newVersion: '1.0.0'
    }
  },
  {
    description: 'Handles "missing" / all zeroes `before` value correctly on push',
    base: '0000000000000000000000000000000000000000',
    head: '4cedd64e7615d69f7bcd229fc960d3e1a6f4b496',
    repo: 'Quantco/ui-actions',
    event: 'push',
    file: 'version-metadata/package.json',
    expected: {
      changed: true,
      oldVersion: '1.0.11',
      newVersion: '1.0.12'
    }
  },
  {
    description:
      'Fallback 0.0.0 version works with custom extractors (https://github.com/Quantco/slim-trees/actions/runs/5436331701/jobs/9886105283)',
    base: 'a30c62ac7f10f68aacc9ba5259246cae0056cc6d',
    head: '951ea5cb02e9a44f28950e32905cfc269607e806',
    repo: 'Quantco/slim-trees',
    event: 'pull_request',
    file: './pixi.toml',
    extractor: 'regex:version = "(.*)"',
    expected: {
      changed: true,
      oldVersion: '0.0.0',
      newVersion: '0.2.1'
    }
  },
  {
    description: 'First publish of pnpm-licenses (https://github.com/Quantco/pnpm-licenses/actions/runs/4565373345)',
    base: '4a57b667820d533bcfee9a6690127abd68a2c033',
    head: '0329c748648fd2a56e5c04d6d219598bf07faffb',
    repo: 'Quantco/pnpm-licenses',
    event: 'pull_request',
    file: './package.json',
    expected: {
      changed: false,
      oldVersion: '1.0.0',
      newVersion: '1.0.0'
    }
  }
]

runTests(tests, argv.verbose === true)
