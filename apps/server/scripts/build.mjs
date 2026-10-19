import { build } from 'esbuild'

// Single-file CommonJS bundle. The only runtime dependency left outside the
// bundle is the native module better-sqlite3, which ships next to it.
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/server.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  external: ['better-sqlite3', 'bufferutil', 'utf-8-validate'],
  logLevel: 'info',
})
