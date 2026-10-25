import { build } from 'esbuild'

// CommonJS server and background-reader bundles. The only runtime dependency
// outside the bundles is the native module better-sqlite3, which ships next to them.
await build({
  entryPoints: { server: 'src/main.ts', 'background-worker': 'src/background/worker.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  define: { 'import.meta.dirname': '__dirname' },
  sourcemap: true,
  external: ['better-sqlite3', 'bufferutil', 'utf-8-validate'],
  logLevel: 'info',
})
