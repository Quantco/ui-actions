import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts'
  },
  dts: false,
  clean: true,
  target: 'es2020',
  // using cjs instead of mjs here, because bundling dependencies doesn't work properly otherwise
  format: ['cjs'],
  sourcemap: true,
  minify: false,
  // have to bundle dependencies because they aren't available otherwise when run inside the action
  noExternal: ['@actions/core', '@actions/github', 'multimatch', 'zod']
})
